import { Test, TestingModule } from '@nestjs/testing';
import { CookieService, TOKEN_KEY } from './cookie.service';
import { JwtService } from '@nestjs/jwt';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { ExecutionContext } from '@nestjs/common';

describe('CookieService', () => {
  let service: CookieService;
  let mockJwtService: JwtService;
  const jwtToken = 'JWT_TOKEN';

  beforeEach(async () => {
    mockJwtService = { sign: () => jwtToken } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CookieService,
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<CookieService>(CookieService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set a cookie containing the user info on the response', () => {
    const user = new UserInfo('Username', ['user_app']);
    const request = { user: user };
    const cookies = {};
    const setCookieMock = jest.fn(
      (key: string, value: string) => (cookies[key] = value),
    );
    const response = {
      cookies: cookies,
      cookie: setCookieMock,
    };
    const context: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any;
    jest.spyOn(mockJwtService, 'sign').mockReturnValue(jwtToken);

    service.addResponseCookie(context);

    expect(setCookieMock).toHaveBeenCalledWith(
      TOKEN_KEY,
      jwtToken,
      expect.anything(),
    );
    expect(mockJwtService.sign).toHaveBeenCalledWith({
      name: 'Username',
      sub: ['user_app'],
    });
    expect(response['cookies'][TOKEN_KEY]).toBe(jwtToken);
  });
});
