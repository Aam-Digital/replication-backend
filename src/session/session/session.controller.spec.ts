import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { JwtService } from '@nestjs/jwt';

describe('SessionController', () => {
  let controller: SessionController;
  let mockJwtService: JwtService;

  beforeEach(async () => {
    mockJwtService = { sign: () => 'token' } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [{ provide: JwtService, useValue: mockJwtService }],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
