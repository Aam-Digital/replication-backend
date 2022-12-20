import { SetMetadata } from '@nestjs/common';

export const ONLY_AUTHENTICATED_KEY = 'onlyAuthenticated';

/**
 * Setting this decorator only allows authenticated/logged-in users to use the endpoint
 * @param value only authenticated users are allowed (default true)
 */
export const OnlyAuthenticated = (value = true) =>
  SetMetadata(ONLY_AUTHENTICATED_KEY, value);
