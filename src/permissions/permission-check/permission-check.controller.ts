import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
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
import { firstValueFrom } from 'rxjs';
import { BasicAuthGuard } from '../../auth/guards/basic-auth/basic-auth.guard';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { Action, PermissionService } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { PermissionCheckRequestDto } from './permission-check.request.dto';

/**
 * Controller exposing permission check endpoints for internal service-to-service use.
 */
@ApiTags('permissions')
@ApiBasicAuth('BasicAuth')
@UseGuards(BasicAuthGuard)
@Controller('permissions')
export class PermissionCheckController {
  private readonly logger = new Logger(PermissionCheckController.name);
  private static readonly VALID_ACTIONS = new Set<Action>([
    'read',
    'create',
    'update',
    'delete',
    'manage',
  ]);

  constructor(
    private readonly userIdentityService: UserIdentityService,
    private readonly permissionService: PermissionService,
    private readonly couchdbService: CouchdbService,
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
  @HttpCode(200)
  @ApiResponse({
    status: 200,
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
      'Request payload is invalid (e.g. missing userIds or entityId).',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  async checkPermissions(@Body() body: PermissionCheckRequestDto) {
    this.logPermissionCheckRequest(body);
    this.validatePermissionCheckRequest(body);

    const action: Action = body.action ?? 'read';
    const entityDoc = await this.loadCanonicalEntityDoc(body.entityId);

    const results = await Promise.all(
      body.userIds.map((userId) => this.evaluatePermissionForUser(userId, action, entityDoc)),
    );

    return Object.fromEntries(results);
  }

  private logPermissionCheckRequest(body: PermissionCheckRequestDto) {
    this.logger.debug(
      `Incoming permission check: userCount=${Array.isArray(body?.userIds) ? body.userIds.length : 0}, ` +
        `entityId=${body?.entityId}, action=${body?.action ?? 'read'}, ` +
        `body keys=${body ? Object.keys(body) : 'null'}`,
    );
  }

  private validatePermissionCheckRequest(body: PermissionCheckRequestDto) {
    if (
      !Array.isArray(body?.userIds) ||
      body.userIds.length === 0 ||
      body.userIds.some((id) => typeof id !== 'string' || id.trim() === '')
    ) {
      throw new BadRequestException('userIds is required');
    }

    if (
      !body?.entityId ||
      typeof body.entityId !== 'string' ||
      body.entityId.trim() === ''
    ) {
      throw new BadRequestException('entityId is required');
    }

    if (
      body.action &&
      !PermissionCheckController.VALID_ACTIONS.has(body.action)
    ) {
      throw new BadRequestException('action is invalid');
    }
  }

  private async evaluatePermissionForUser(
    userId: string,
    action: Action,
    entityDoc: unknown,
  ) {
    try {
      const user = await this.userIdentityService.resolveUser(userId);
      const permitted = await this.permissionService.isAllowedTo(
        action,
        entityDoc,
        user,
        'app',
      );

      return [userId, { permitted }] as const;
    } catch (error) {
      return this.handlePermissionEvaluationError(userId, error);
    }
  }

  private handlePermissionEvaluationError(userId: string, error: unknown) {
    // Infrastructure failure: Keycloak unreachable or returned a server error -> fail the whole batch
    if (
      error instanceof AxiosError &&
      (!error.response || error.response.status >= 500)
    ) {
      throw new BadGatewayException('Upstream identity provider is unavailable');
    }

    // User not found in Keycloak (404) or bad user ID format (400)
    if (this.isClientError(error)) {
      return [userId, { permitted: false, error: 'NOT_FOUND' }] as const;
    }

    this.logger.error(
      `Failed to evaluate permissions for user ${userId}`,
      error instanceof Error ? error.stack || error.message : String(error),
    );
    return [userId, { permitted: false, error: 'ERROR' }] as const;
  }

  private isClientError(error: unknown) {
    return (
      (error instanceof AxiosError &&
        error.response?.status !== undefined &&
        error.response.status >= 400 &&
        error.response.status < 500) ||
      (error instanceof HttpException &&
        error.getStatus() >= 400 &&
        error.getStatus() < 500)
    );
  }

  private async loadCanonicalEntityDoc(entityId: string) {
    try {
      return await firstValueFrom(this.couchdbService.get('app', entityId));
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) {
        throw new BadRequestException(`entityDoc not found: ${entityId}`);
      }

      this.logger.error(
        `Failed to load canonical entity document ${entityId}`,
        error?.stack || error,
      );
      throw new BadGatewayException('Failed to load target entity document');
    }
  }
}
