import { Test, TestingModule } from '@nestjs/testing';
import { CouchAuthStrategy } from './couch-auth.strategy';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { COUCH_ENDPOINT } from '../../app.module';
import { HttpException, UnauthorizedException } from '@nestjs/common';

describe('CouchAuthStrategy', () => {
  let strategy: CouchAuthStrategy;
  let mockHttpService: HttpService;

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouchAuthStrategy,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    strategy = module.get<CouchAuthStrategy>(CouchAuthStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('should return the user after receiving success response', async () => {
    const credentials = { name: 'username', password: 'somePass' };
    jest.spyOn(mockHttpService, 'post').mockReturnValue(
      of({
        data: { name: credentials.name, roles: ['user_app'] },
      } as any),
    );

    const response = await strategy.validate(
      credentials.name,
      credentials.password,
    );

    expect(mockHttpService.post).toHaveBeenCalledWith(
      `${COUCH_ENDPOINT}/_session`,
      credentials,
    );
    expect(response).toEqual({ name: 'username', roles: ['user_app'] });
  });

  it('should throw unauthorized exception when the requests fails', () => {
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(throwError(() => new HttpException('error', 400)));

    return expect(strategy.validate('user', 'wrong_pw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
