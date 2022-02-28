import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SentryModule } from '@ntegral/nestjs-sentry';
import { Severity } from '@sentry/types';
import { RestrictedEndpointsModule } from './restricted-endpoints/restricted-endpoints.module';
import { CombinedAuthMiddleware } from './auth/guards/combined-auth.middleware';
import { AuthModule } from './auth/auth.module';
import { CouchdbModule } from './couchdb/couchdb.module';
import * as Sentry from '@sentry/node';

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
          release: 'backend@' + process.env.npm_package_version,
          initialScope: {
            tags: {
              hostname: process.env.HOSTNAME || 'unknown',
            },
          },
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
    consumer.apply(CombinedAuthMiddleware).exclude('_session').forRoutes('*');
  }
}
