import { Test, TestingModule } from '@nestjs/testing';
import { CouchProxyController } from './couch-proxy.controller';

describe('CouchProxyController', () => {
  let controller: CouchProxyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouchProxyController],
    }).compile();

    controller = module.get<CouchProxyController>(CouchProxyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
