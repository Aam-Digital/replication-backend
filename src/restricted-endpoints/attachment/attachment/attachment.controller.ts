import {
  Controller,
  ForbiddenException,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { User } from '../../../auth/user.decorator';
import { UserInfo } from '../../session/user-auth.dto';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { concatMap, firstValueFrom, map } from 'rxjs';
import { Request } from 'express';

@UseGuards(CombinedAuthGuard)
@Controller(':db/:docId/:property')
export class AttachmentController {
  constructor(
    private couchDB: CouchdbService,
    private permissions: PermissionService,
  ) {}
  @ApiBody({})
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
    const res = await this.getAttachmentData(req);
    return firstValueFrom(
      this.couchDB.get(db.replace('-attachments', ''), docId).pipe(
        map((doc) => {
          if (
            this.permissions.getAbilityFor(user).cannot('update', doc, property)
          ) {
            throw new ForbiddenException(
              'unauthorized',
              'User is not permitted',
            );
          } else {
            return doc;
          }
        }),
        concatMap(() =>
          this.couchDB.putAttachment(db, `${docId}/${property}`, res, {
            params,
            headers: { 'content-type': req.headers['content-type'] },
          }),
        ),
      ),
    );
  }

  private getAttachmentData(req: Request) {
    return new Promise<Buffer>((resolve) => {
      const res = [];
      req.on('data', (chunk) => {
        res.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(res));
      });
    });
  }
}
