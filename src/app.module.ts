import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { setUser } from '@sentry/node';
import { NextFunction, Request, Response } from 'express';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { AppConfiguration } from './config/configuration';
import { CouchdbModule } from './couchdb/couchdb.module';
import { RestrictedEndpointsModule } from './restricted-endpoints/restricted-endpoints.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
      load: [AppConfiguration],
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
      .apply((req: Request, res: Response, next: NextFunction) => {
        // reset user before processing a request
        setUser({ username: 'unknown' });
        next();
      })
      .forRoutes('*');
  }
}
