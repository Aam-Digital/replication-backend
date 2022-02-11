import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { HttpModule } from '@nestjs/axios';
import { DocumentService } from './document.service';
import { PermissionModule } from '../../permissions/permission.module';

@Module({
  imports: [HttpModule, PermissionModule],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentModule {}
