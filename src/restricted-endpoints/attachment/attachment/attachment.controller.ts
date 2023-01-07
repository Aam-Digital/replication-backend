import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { User } from '../../../auth/user.decorator';
import { UserInfo } from '../../session/user-auth.dto';
import { ApiQuery } from '@nestjs/swagger';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { concatMap, map, Subject } from 'rxjs';
import { Request, Response } from 'express';
import { RestrictedEndpointsModule } from '../../restricted-endpoints.module';

/**
 * This controller handles uploading and downloading of attachments.
 * The permissions are evaluated based on the `read` or `update` permission
 * of the entity for which an attachment is saved.
 */
@UseGuards(CombinedAuthGuard)
@Controller(':db/:docId/:property')
export class AttachmentController {
  constructor(
    private couchDB: CouchdbService,
    private permissions: PermissionService,
  ) {}

  /**
   * Upload an attachment using binary data if the user has `update` permissions.
   * @param db name of the attachment database (`...-attachments`)
   * @param docId ID of the doc
   * @param property on the entity where the file name is stored
   * @param params needs to include the rev of the attachment document
   * @param user which makes the request
   * @param request which holds the binary file data
   */
  @ApiQuery({})
  @Put()
  async createAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @Query() params: string,
    @User() user: UserInfo,
    @Req() request: Request,
  ) {
    return this.ensurePermissions(user, 'update', db, docId, property).pipe(
      concatMap(() => this.readDataAsBuffer(request)),
      concatMap((file) =>
        this.couchDB.putAttachment(db, `${docId}/${property}`, file, {
          params,
          headers: { 'content-type': request.headers['content-type'] },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      ),
    );
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
  getAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @User() user: UserInfo,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    this.ensurePermissions(user, 'read', db, docId, property).subscribe(() =>
      RestrictedEndpointsModule.proxy(request, response, () => undefined),
    );
  }

  private ensurePermissions(
    user: UserInfo,
    action: 'read' | 'update',
    db: string,
    docId: string,
    property: string,
  ) {
    return this.couchDB.get(db.replace('-attachments', ''), docId).pipe(
      map((doc) => {
        if (
          this.permissions.getAbilityFor(user).cannot(action, doc, property)
        ) {
          throw new ForbiddenException('unauthorized', 'User is not permitted');
        } else {
          return doc;
        }
      }),
    );
  }

  private readDataAsBuffer(req: Request) {
    const result = new Subject<Buffer>();
    const res = [];
    req.on('data', (chunk) => {
      res.push(chunk);
    });

    req.on('end', () => {
      result.next(Buffer.concat(res));
      result.complete();
    });
    return result;
  }
}
