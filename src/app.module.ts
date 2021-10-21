import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReplicationModule } from './replication/replication.module';
import { UserModule } from './user/user.module';
import { SentryModule } from '@ntegral/nestjs-sentry';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ReplicationModule,
    UserModule,
    SentryModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        dsn: configService.get('SENTRY_DSN'),
        debug: true,
        environment: 'prod',
        release: 'backend@latest',
        whitelistUrls: [/https?:\/\/(.*)\.?aam-digital\.com/],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
