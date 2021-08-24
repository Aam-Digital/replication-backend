import { Test, TestingModule } from '@nestjs/testing';
import { CouchProxyController } from './couch-proxy.controller';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';

describe('CouchProxyController', () => {
  let controller: CouchProxyController;
  let mockHttpService: HttpService;

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
      get: () => of({}),
      put: () => of({}),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouchProxyController],
      providers: [{ provide: HttpService, useValue: mockHttpService }],
    }).compile();

    controller = module.get<CouchProxyController>(CouchProxyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
