import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PermissionModule } from '../../permissions/permission.module';
import { DesignDocumentController } from './design-document.controller';
import { DocumentController } from './document.controller';

@Module({
  imports: [HttpModule, PermissionModule, AuthModule],
  controllers: [DesignDocumentController, DocumentController],
})
export class DocumentModule {}
