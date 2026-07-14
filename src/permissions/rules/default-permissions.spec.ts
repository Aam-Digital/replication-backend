import {
  MANAGED_DEFAULT_RULES,
  mergeManagedDefaults,
  SYSTEM_DEFAULT_MARKER,
} from './default-permissions';
import { DocumentRule } from './rules.service';

describe('mergeManagedDefaults', () => {
  const adminRule: DocumentRule = { action: 'read', subject: 'Child' };

  it('should prepend managed defaults before existing admin rules', () => {
    const { merged, changed } = mergeManagedDefaults([adminRule]);

    expect(changed).toBe(true);
    expect(merged).toEqual([...MANAGED_DEFAULT_RULES, adminRule]);

    // a missing default section yields exactly the managed rules
    const fromEmpty = mergeManagedDefaults(undefined);
    expect(fromEmpty.changed).toBe(true);
    expect(fromEmpty.merged).toEqual(MANAGED_DEFAULT_RULES);
  });

  it('should report unchanged when managed defaults are already present', () => {
    const { merged } = mergeManagedDefaults([adminRule]);

    const second = mergeManagedDefaults(merged);

    expect(second.changed).toBe(false);
    expect(second.merged).toEqual(merged);
  });

  it('should replace outdated system-default rules instead of duplicating them', () => {
    const outdated: DocumentRule = {
      action: 'read',
      subject: 'OldSubject',
      reason: `${SYSTEM_DEFAULT_MARKER} outdated rule`,
    };

    const { merged, changed } = mergeManagedDefaults([outdated, adminRule]);

    expect(changed).toBe(true);
    expect(merged).toEqual([...MANAGED_DEFAULT_RULES, adminRule]);
  });
});
