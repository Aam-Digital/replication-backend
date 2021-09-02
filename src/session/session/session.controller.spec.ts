import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of } from 'rxjs';
import { SessionService } from './session.service';
import { COUCH_ENDPOINT } from '../../app.module';

describe('SessionController', () => {
  let controller: SessionController;
  let mockHttpService: HttpService;
  let mockSessionService: SessionService;

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
    } as any;
    mockSessionService = {
      login: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: HttpService, useValue: mockHttpService },
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should login the user after receiving successful response', async () => {
    const credentials = { name: 'username', password: 'somePass' };
    jest.spyOn(mockHttpService, 'post').mockReturnValue(
      of({
        data: { name: credentials.name, roles: ['user_app'] },
      } as any),
    );
    jest.spyOn(mockSessionService, 'login');

    const response = await firstValueFrom(controller.session(credentials));

    expect(mockHttpService.post).toHaveBeenCalledWith(
      `${COUCH_ENDPOINT}/_session`,
      credentials,
    );
    expect(mockSessionService.login).toHaveBeenCalledWith({
      name: 'username',
      roles: ['user_app'],
    });
    expect(response).toEqual({ name: 'username', roles: ['user_app'] });
  });
});
