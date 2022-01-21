import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { HttpModule } from '@nestjs/axios';
import { UserService } from './user.service';
import { PermissionModule } from '../permissions/permission.module';

@Module({
  imports: [HttpModule, PermissionModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
