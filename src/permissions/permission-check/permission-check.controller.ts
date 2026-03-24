import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBasicAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AxiosError } from 'axios';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../../auth/only-authenticated.decorator';
import { PermissionService } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { PermissionCheckRequestDto } from './permission-check.request.dto';

/**
 * Controller exposing permission check endpoints for internal service-to-service use.
 */
@ApiTags('permissions')
@ApiBasicAuth('BasicAuth')
@OnlyAuthenticated()
@UseGuards(CombinedAuthGuard)
@Controller('permissions')
export class PermissionCheckController {
  private readonly logger = new Logger(PermissionCheckController.name);

  constructor(
    private readonly userIdentityService: UserIdentityService,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * Checks if users are allowed to perform an action on a given entity document.
   */
  @Post('/check')
  @ApiOperation({ summary: 'Check user permissions for a document in batch' })
  @ApiBody({
    description: 'List of user ids and one target document to evaluate.',
    type: PermissionCheckRequestDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Permission result for each user id.',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          permitted: { type: 'boolean' },
          error: {
            type: 'string',
            enum: ['NOT_FOUND', 'ERROR'],
            description:
              'Present only when the check failed for this user. ' +
              'NOT_FOUND = unknown userId, ERROR = unexpected failure.',
          },
        },
        required: ['permitted'],
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Request payload is invalid (e.g. missing userIds or entityDoc._id).',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  async checkPermissions(@Body() body: PermissionCheckRequestDto) {
    if (!body?.userIds?.length) {
      throw new BadRequestException('userIds is required');
    }
    if (!body?.entityDoc?._id) {
      throw new BadRequestException('entityDoc._id is required');
    }

    const action = body.action || 'read';
    const results = await Promise.all(
      body.userIds.map(async (userId) => {
        try {
          const user = await this.userIdentityService.resolveUser(userId);
          const permitted = await this.permissionService.isAllowedTo(
            action,
            body.entityDoc,
            user,
            'app',
          );

          return [userId, { permitted }] as const;
        } catch (error) {
          // Infrastructure failure: Keycloak unreachable or returned a server error → fail the whole batch
          if (
            error instanceof AxiosError &&
            (!error.response || error.response.status >= 500)
          ) {
            throw new BadGatewayException(
              'Upstream identity provider is unavailable',
            );
          }

          // User not found in Keycloak
          if (
            error instanceof AxiosError &&
            error.response?.status === 404
          ) {
            return [userId, { permitted: false, error: 'NOT_FOUND' }] as const;
          }

          this.logger.error(
            `Failed to evaluate permissions for user ${userId}`,
            error?.stack || error,
          );
          return [userId, { permitted: false, error: 'ERROR' }] as const;
        }
      }),
    );

    return Object.fromEntries(results);
  }
}
