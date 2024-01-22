import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { HttpModule } from '@nestjs/axios';
import { PermissionModule } from '../../permissions/permission.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [HttpModule, PermissionModule, AuthModule],
  controllers: [DocumentController],
})
export class DocumentModule {}
