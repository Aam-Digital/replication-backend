import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReplicationModule } from './replication/replication.module';
import { DocumentModule } from './user/document.module';
import { SentryModule } from '@ntegral/nestjs-sentry';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ReplicationModule,
    DocumentModule,
    SentryModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        if (!configService.get('SENTRY_DSN')) {
          return;
        }

        return {
          dsn: configService.get('SENTRY_DSN'),
          debug: true,
          environment: 'prod',
          release: 'backend@latest',
          whitelistUrls: [/https?:\/\/(.*)\.?aam-digital\.com/],
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
