import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReplicationModule } from './replication/replication.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ReplicationModule, UserModule],
})
export class AppModule {}
