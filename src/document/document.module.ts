import { HttpException, Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { HttpModule, HttpService } from '@nestjs/axios';
import { DocumentService } from './document.service';
import { PermissionModule } from '../permissions/permission.module';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../utils/couchdb-interacter';

@Module({
  imports: [HttpModule, PermissionModule],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentModule {
  constructor(
    public httpService: HttpService,
    public configService: ConfigService,
  ) {
    // TODO maybe introduce HttpModule wrapper
    // Send the basic auth header with every request
    this.httpService.axiosRef.defaults.auth = {
      username: this.configService.get<string>(
        CouchDBInteracter.DATABASE_USER_ENV,
      ),
      password: this.configService.get<string>(
        CouchDBInteracter.DATABASE_PASSWORD_ENV,
      ),
    };

    // Map the Axios errors to NestJS exceptions
    this.httpService.axiosRef.interceptors.response.use(undefined, (err) => {
      throw new HttpException(err.response.data, err.response.status);
    });
  }
}
