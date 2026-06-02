import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PermissionModule } from '../../permissions/permission.module';
import { DesignDocumentController } from './design-document.controller';
import { DocumentController } from './document.controller';
import { DocumentWriteService } from './document-write.service';

@Module({
  imports: [HttpModule, PermissionModule, AuthModule],
  controllers: [DesignDocumentController, DocumentController],
  providers: [DocumentWriteService],
})
export class DocumentModule {}
