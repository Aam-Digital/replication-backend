import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReplicationModule } from './replication/replication.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ReplicationModule],
})
export class AppModule {}
