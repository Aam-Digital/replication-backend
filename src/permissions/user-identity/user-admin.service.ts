import { UserAccount } from '../../restricted-endpoints/session/user-auth.dto';

/**
 * Abstract user admin API to decouple identity resolution from a specific IAM provider.
 */
export abstract class UserAdminService {
  /**
   * Fetches the IAM account for a given user id, including entity name and roles.
   * Does not include application-level data like projects.
   */
  abstract getUserAccount(userId: string): Promise<UserAccount>;
}
