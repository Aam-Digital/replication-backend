import { Test, TestingModule } from '@nestjs/testing';
import { CookieService, TOKEN_KEY } from './cookie.service';
import { JwtService } from '@nestjs/jwt';
import { User } from '../session/user-auth.dto';
import { Response } from 'express';

describe('CookieService', () => {
  let service: CookieService;
  let mockJwtService: JwtService;
  const jwtToken = 'JWT_TOKEN'

  beforeEach(async () => {
    mockJwtService = { sign: () => jwtToken } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CookieService,
        { provide: JwtService, useValue: mockJwtService }
      ],
    }).compile();

    service = module.get<CookieService>(CookieService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set a cookie containing the user info on the response', () => {
    const user: User = { name: 'Username', roles: ['user_app'] };
    const cookies = { };
    const setCookieMock = jest.fn((key: string, value: string) => cookies[key] = value);
    const response: Response = {
      cookies: cookies,
      cookie: setCookieMock,
    } as any;
    jest.spyOn(mockJwtService, 'sign').mockReturnValue(jwtToken);

    service.addResponseCookie(user, response);

    expect(setCookieMock.mock.calls[0][0]).toBe(TOKEN_KEY);
    expect(setCookieMock.mock.calls[0][1]).toBe(jwtToken);
    expect(mockJwtService.sign).toHaveBeenCalledWith({ name: 'Username', sub: ['user_app'] })
    expect(response['cookies'][TOKEN_KEY]).toBe(jwtToken);
  });
});
