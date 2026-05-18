import { HttpException, HttpStatus } from '@nestjs/common';
import {
  isAuthHttpError,
  isLikelyTransientError,
} from './http-error-classification';

describe('http-error-classification', () => {
  describe('isAuthHttpError', () => {
    it('returns true for 401 and 403 HttpException', () => {
      expect(
        isAuthHttpError(
          new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED),
        ),
      ).toBe(true);
      expect(
        isAuthHttpError(new HttpException('Forbidden', HttpStatus.FORBIDDEN)),
      ).toBe(true);
    });

    it('returns false for non-auth HttpException and non-HttpException values', () => {
      expect(
        isAuthHttpError(
          new HttpException('Bad Request', HttpStatus.BAD_REQUEST),
        ),
      ).toBe(false);
      expect(isAuthHttpError(new Error('Unauthorized'))).toBe(false);
    });
  });

  describe('isLikelyTransientError', () => {
    it('returns true for transient HttpException status codes', () => {
      expect(
        isLikelyTransientError(
          new HttpException('Bad Gateway', HttpStatus.BAD_GATEWAY),
        ),
      ).toBe(true);
      expect(
        isLikelyTransientError(
          new HttpException(
            'Service unavailable',
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        ),
      ).toBe(true);
    });

    it('returns true for transient network markers in generic errors', () => {
      expect(isLikelyTransientError(new Error('connect ECONNREFUSED'))).toBe(
        true,
      );
      expect(isLikelyTransientError(new Error('socket hang up'))).toBe(true);
    });

    it('returns false for non-transient errors', () => {
      expect(
        isLikelyTransientError(
          new HttpException('Bad Request', HttpStatus.BAD_REQUEST),
        ),
      ).toBe(false);
      expect(isLikelyTransientError(new Error('validation failed'))).toBe(
        false,
      );
    });
  });
});
