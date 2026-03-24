import {
  BadRequestException,
  Body,
  Controller,
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
        },
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
          return [userId, { permitted: false }] as const;
        }
      }),
    );

    return Object.fromEntries(results);
  }
}
