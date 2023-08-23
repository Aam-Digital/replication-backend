import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { User } from '../../../auth/user.decorator';
import { UserInfo } from '../../session/user-auth.dto';
import { ApiQuery } from '@nestjs/swagger';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { firstValueFrom } from 'rxjs';
import { Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ConfigService } from '@nestjs/config';
import { QueryParams } from '../../replication/bulk-document/couchdb-dtos/document.dto';

/**
 * This controller handles uploading and downloading of attachments.
 * The permissions are evaluated based on the `read` or `update` permission
 * of the entity for which an attachment is saved.
 */
@UseGuards(CombinedAuthGuard)
@Controller(':db/:docId/:property')
export class AttachmentController {
  private databaseUrl = this.configService.get<string>(
    CouchdbService.DATABASE_URL_ENV,
  );
  private databaseUser = this.configService.get<string>(
    CouchdbService.DATABASE_USER_ENV,
  );
  private databasePassword = this.configService.get<string>(
    CouchdbService.DATABASE_PASSWORD_ENV,
  );
  /**
   * This proxy allows to send authenticated requests to the real database
   */
  proxy = createProxyMiddleware({
    target: this.databaseUrl,
    secure: true,
    changeOrigin: true,
    followRedirects: false,
    xfwd: true,
    autoRewrite: true,
    onProxyReq: (proxyReq) => {
      // Removing existing cookie and overwriting header with authorized credentials
      const authHeader = Buffer.from(
        `${this.databaseUser}:${this.databasePassword}`,
      ).toString('base64');
      proxyReq.setHeader('authorization', `Basic ${authHeader}`);
      proxyReq.removeHeader('cookie');
    },
  });
  constructor(
    private couchDB: CouchdbService,
    private permissions: PermissionService,
    private configService: ConfigService,
  ) {}

  /**
   * Upload an attachment using binary data if the user has `update` permissions.
   * @param db name of the attachment database (`...-attachments`)
   * @param docId ID of the doc
   * @param property on the entity where the file name is stored
   * @param params needs to include the rev of the attachment document
   * @param user which makes the request
   * @param request which holds the binary file data
   * @param response
   */
  @ApiQuery({})
  @Put()
  async createAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @Query() params: any,
    @User() user: UserInfo,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.ensurePermissions(user, 'update', db, docId, property);
    this.proxy(request, response, () => undefined);
  }

  /**
   * Returns an attachment if the user has `read` permissions.
   * @param db name of the database
   * @param docId name of the attachment database (`...-attachments`)
   * @param property on the entity where the file name is stored
   * @param user which makes the request
   * @param request
   * @param response
   */
  @Get()
  async getAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @User() user: UserInfo,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.ensurePermissions(user, 'read', db, docId, property);
    this.proxy(request, response, () => undefined);
  }

  /**
   * Returns an attachment if the user has `read` permissions.
   * @param db name of the database
   * @param docId name of the attachment database (`...-attachments`)
   * @param property on the entity where the file name is stored
   * @param params additional params that will be forwarded
   * @param user which makes the request
   */
  @Delete()
  async deleteAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @Query() params: QueryParams,
    @User() user: UserInfo,
  ) {
    await this.ensurePermissions(user, 'read', db, docId, property);
    return this.couchDB.delete(db, `${docId}/${property}`, params);
  }

  private async ensurePermissions(
    user: UserInfo,
    action: 'read' | 'update' | 'delete',
    db: string,
    docId: string,
    property: string,
  ) {
    const doc = await firstValueFrom(
      this.couchDB.get(db.replace('-attachments', ''), docId),
    );
    const ability = this.permissions.getAbilityFor(user);
    const permitted = ability.can(action, doc, property);
    if (!permitted && user) {
      throw new ForbiddenException('unauthorized', 'User is not permitted');
    } else if (!permitted && !user) {
      throw new UnauthorizedException(
        'unauthorized',
        'User is not authenticated',
      );
    }
  }
}
