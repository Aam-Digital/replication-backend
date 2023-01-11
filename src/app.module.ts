import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SentryInterceptor, SentryModule } from '@ntegral/nestjs-sentry';
import { SeverityLevel } from '@sentry/types';
import { RestrictedEndpointsModule } from './restricted-endpoints/restricted-endpoints.module';
import { AuthModule } from './auth/auth.module';
import { CouchdbModule } from './couchdb/couchdb.module';
import * as Sentry from '@sentry/node';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';

const lowSeverityLevels: SeverityLevel[] = ['log', 'info'];

@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useFactory: () => new SentryInterceptor() },
  ],
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
          release: 'backend@' + process.env.npm_package_version,
          whitelistUrls: [/https?:\/\/(.*)\.?aam-digital\.com/],
          initialScope: {
            tags: {
              // ID of the docker container in which this is run
              hostname: process.env.HOSTNAME || 'unknown',
            },
          },
          beforeSend: (event) => {
            if (lowSeverityLevels.includes(event.level)) {
              return null;
            } else {
              return event;
            }
          },
        };
      },
    }),
    AdminModule,
    CouchdbModule,
    AuthModule,
    RestrictedEndpointsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((req, res, next) => {
        // reset user before processing a request
        Sentry.setUser({ username: 'unknown' });
        next();
      })
      .forRoutes('*');
  }
}
