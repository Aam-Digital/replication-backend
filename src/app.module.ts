import {
  HttpException,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SentryModule } from '@ntegral/nestjs-sentry';
import { Severity } from '@sentry/types';
import { ProxyModule } from './proxy/proxy.module';
import { RestrictedEndpointsModule } from './restricted-endpoints/restricted-endpoints.module';
import { HttpModule, HttpService } from '@nestjs/axios';
import { CouchDBInteracter } from './utils/couchdb-interacter';
import { CombinedAuthMiddleware } from './auth/guards/combined-auth.middleware';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    AuthModule,
    HttpModule,
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
export class AppModule implements NestModule {
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // TODO maybe introduce HttpModule wrapper
    this.initAddBasicAuthHeaderByDefault();
    this.initMapAxiosErrorsToNestjsExceptions();
  }

  private initAddBasicAuthHeaderByDefault() {
    this.httpService.axiosRef.defaults.auth = {
      username: this.configService.get<string>(
        CouchDBInteracter.DATABASE_USER_ENV,
      ),
      password: this.configService.get<string>(
        CouchDBInteracter.DATABASE_PASSWORD_ENV,
      ),
    };
  }

  private initMapAxiosErrorsToNestjsExceptions() {
    this.httpService.axiosRef.interceptors.response.use(undefined, (err) => {
      throw new HttpException(err.response.data, err.response.status);
    });
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CombinedAuthMiddleware).exclude('_session').forRoutes('*');
  }
}
