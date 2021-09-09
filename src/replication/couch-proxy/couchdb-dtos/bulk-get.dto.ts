import { DatabaseDocument, DocError } from './bulk-docs.dto';
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

class BulkGetRequestDoc {
  id: string;
  rev?: string;
}

export class BulkGetRequest {
  docs: BulkGetRequestDoc[];
}

class OkDoc {
  ok: DatabaseDocument;
}

class ErrorDoc {
  error: DocError;
}

@ApiExtraModels(OkDoc, ErrorDoc)
class BulkGetResult {
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
