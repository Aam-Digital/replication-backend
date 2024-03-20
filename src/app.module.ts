import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RestrictedEndpointsModule } from './restricted-endpoints/restricted-endpoints.module';
import { AuthModule } from './auth/auth.module';
import { CouchdbModule } from './couchdb/couchdb.module';
import { AdminModule } from './admin/admin.module';
import { setUser } from '@sentry/node';
import { AppConfiguration } from './config/configuration';

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
      .apply((req, res, next) => {
        // reset user before processing a request
        setUser({ username: 'unknown' });
        next();
      })
      .forRoutes('*');
  }
}
