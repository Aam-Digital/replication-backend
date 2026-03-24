import { ApiProperty } from '@nestjs/swagger';
import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { Action } from '../permission/permission.service';

/**
 * Payload for batch permission checks.
 */
export class PermissionCheckRequestDto {
  @ApiProperty({
    description: 'List of keycloak user ids to evaluate.',
    type: [String],
  })
  userIds: string[];

  @ApiProperty({
    description: 'Target entity document used for permission evaluation.',
    type: 'object',
    additionalProperties: true,
    required: ['_id'],
    properties: {
      _id: { type: 'string' },
    },
  })
  entityDoc: DatabaseDocument;

  @ApiProperty({
    description: 'Action to evaluate.',
    enum: ['read', 'create', 'update', 'delete', 'manage'],
    default: 'read',
    required: false,
  })
  action: Action;
}
