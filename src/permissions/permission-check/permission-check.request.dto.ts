import { ApiProperty } from '@nestjs/swagger';
import { Action } from '../permission/permission.service';

/**
 * Payload for batch permission checks.
 */
export class PermissionCheckRequestDto {
  @ApiProperty({
    description: 'List of keycloak user ids to evaluate.',
    type: [String],
  })
  userIds!: string[];

  @ApiProperty({
    description:
      'The _id of the target entity document to check permissions against.',
    type: 'string',
    example: 'Child:1',
  })
  entityId!: string;

  @ApiProperty({
    description: 'Action to evaluate.',
    enum: ['read', 'create', 'update', 'delete', 'manage'],
    default: 'read',
    required: false,
  })
  action?: Action;
}
