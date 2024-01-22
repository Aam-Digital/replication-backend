import { DatabaseDocument, DocError } from './bulk-docs.dto';
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

class BulkGetRequestDoc {
  id: string;
  rev?: string;
}

export class BulkGetRequest {
  docs: BulkGetRequestDoc[];
}

export class OkDoc {
  ok: DatabaseDocument;
}

export class ErrorDoc {
  error: DocError;
}

@ApiExtraModels(OkDoc, ErrorDoc)
export class BulkGetResult {
  id: string;
  @ApiProperty({
    type: 'array',
    oneOf: [{ $ref: getSchemaPath(OkDoc) }, { $ref: getSchemaPath(ErrorDoc) }],
  })
  docs: (OkDoc | ErrorDoc)[];
}

export class BulkGetResponse {
  results: BulkGetResult[];
}
