import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SentryModule } from '@ntegral/nestjs-sentry';
import { Severity } from '@sentry/types';
import { ProxyModule } from './proxy/proxy.module';
import { RestrictedEndpointsModule } from './restricted-endpoints/restricted-endpoints.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SentryModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
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
          beforeSend: (event) => {
            if ([Severity.Log, Severity.Info].includes(event.level)) {
              return null;
            } else {
              return event;
            }
          },
        };
      },
    }),
    ProxyModule,
    RestrictedEndpointsModule,
  ],
})
export class AppModule {}
