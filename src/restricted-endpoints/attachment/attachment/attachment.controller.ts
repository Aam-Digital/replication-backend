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

@UseGuards(CombinedAuthGuard)
@Controller(':db/:docId/:property')
export class AttachmentController {
  constructor(
    private couchDB: CouchdbService,
    private permissions: PermissionService,
  ) {}

  @ApiQuery({})
  @Put()
  async createAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @Query() params: string,
    @User() user: UserInfo,
    @Req() req: Request,
  ) {
    return this.ensurePermissions(user, 'update', db, docId, property).pipe(
      concatMap(() => this.readDataAsBuffer(req)),
      concatMap((file) =>
        this.couchDB.putAttachment(db, `${docId}/${property}`, file, {
          params,
          headers: { 'content-type': req.headers['content-type'] },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      ),
    );
  }

  @Get()
  getAttachment(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Param('property') property: string,
    @User() user: UserInfo,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    this.ensurePermissions(user, 'read', db, docId, property).subscribe(() =>
      RestrictedEndpointsModule.proxy(req, res, () => undefined),
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
