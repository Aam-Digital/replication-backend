import { ConfigService } from '@nestjs/config';
import { DocumentFilterService } from './document-filter.service';

describe('DocumentFilterService', () => {
  function createService(envValue?: string): DocumentFilterService {
    const configService = {
      get: jest.fn().mockReturnValue(envValue),
    } as any as ConfigService;
    return new DocumentFilterService(configService);
  }

  describe('default configuration', () => {
    let service: DocumentFilterService;

    beforeEach(() => {
      service = createService(undefined);
    });

    it('should filter _design/ documents', () => {
      expect(service.isReplicable('_design/some-view')).toBe(false);
      expect(service.isReplicable('_design/conflicts')).toBe(false);
    });

    it('should allow regular entity documents', () => {
      expect(service.isReplicable('Child:abc123')).toBe(true);
      expect(service.isReplicable('School:1')).toBe(true);
    });

    it('should allow documents whose ID contains but does not start with _design/', () => {
      expect(service.isReplicable('Note:_design/test')).toBe(true);
    });
  });

  describe('custom configuration', () => {
    it('should use prefixes from environment variable', () => {
      const service = createService('_design/, test-');

      expect(service.isReplicable('_design/foo')).toBe(false);
      expect(service.isReplicable('test-doc')).toBe(false);
      expect(service.isReplicable('Child:1')).toBe(true);
    });

    it('should handle a single custom prefix', () => {
      const service = createService('custom_prefix:');

      expect(service.isReplicable('custom_prefix:doc')).toBe(false);
      expect(service.isReplicable('_design/foo')).toBe(true);
    });

    it('should ignore empty entries in comma-separated list', () => {
      const service = createService('_design/,,, _local/');

      expect(service.isReplicable('_design/x')).toBe(false);
      expect(service.isReplicable('_local/y')).toBe(false);
      expect(service.isReplicable('Child:1')).toBe(true);
    });
  });
});
