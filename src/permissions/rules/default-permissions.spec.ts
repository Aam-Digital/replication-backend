import type { ManagedRulesMerge } from './default-permissions';
import {
  MANAGED_DEFAULT_RULES,
  MANAGED_PUBLIC_RULES,
  mergeManagedDefaults,
  mergeManagedPublic,
  SYSTEM_DEFAULT_MARKER,
} from './default-permissions';
import type { DocumentRule } from './rules.service';

describe('mergeManagedDefaults', () => {
  const adminRule: DocumentRule = { action: 'read', subject: 'Child' };

  it('should prepend managed defaults before existing admin rules', () => {
    const { merged, changed } = mergeManagedDefaults([adminRule]);

    expect(changed).toBe(true);
    expect(merged).toEqual([...MANAGED_DEFAULT_RULES, adminRule]);

    // a missing default section yields exactly the managed rules
    const fromEmpty = mergeManagedDefaults();
    expect(fromEmpty.changed).toBe(true);
    expect(fromEmpty.merged).toEqual(MANAGED_DEFAULT_RULES);

    // a malformed (non-array) default section is healed instead of throwing
    const fromMalformed = mergeManagedDefaults(null as any);
    expect(fromMalformed.changed).toBe(true);
    expect(fromMalformed.merged).toEqual(MANAGED_DEFAULT_RULES);
  });

  it('should report unchanged when managed defaults are already present', () => {
    const { merged } = mergeManagedDefaults([adminRule]);

    const second = mergeManagedDefaults(merged);

    expect(second.changed).toBe(false);
    expect(second.merged).toEqual(merged);
    expect(second.dropped).toEqual([]);
  });

  it('should replace outdated system-default rules instead of duplicating them', () => {
    const outdated: DocumentRule = {
      action: 'read',
      subject: 'OldSubject',
      reason: `${SYSTEM_DEFAULT_MARKER} outdated rule`,
    };

    const { merged, changed, dropped } = mergeManagedDefaults([
      outdated,
      adminRule,
    ]);

    expect(changed).toBe(true);
    expect(merged).toEqual([...MANAGED_DEFAULT_RULES, adminRule]);
    expect(dropped).toEqual([outdated]);
  });
});

describe('mergeManagedPublic', () => {
  const adminRule: DocumentRule = { action: 'create', subject: 'Child' };

  /** merge an existing section (only a missing section returns undefined) */
  const mergeSection = (section: DocumentRule[]) =>
    mergeManagedPublic(section) as ManagedRulesMerge;

  it('should not create a _public section for instances without public forms', () => {
    expect(mergeManagedPublic(undefined)).toBeUndefined();
  });

  it('should extend a _public section that is actively used', () => {
    const result = mergeSection([adminRule]);

    expect(result.changed).toBe(true);
    expect(result.merged).toEqual([...MANAGED_PUBLIC_RULES, adminRule]);
  });

  it('should grant read access to the permission config itself', () => {
    // without this an anonymous client cannot load its own rules and
    // falls back to allowing everything locally
    const { merged } = mergeSection([adminRule]);

    expect(
      merged.some(
        (rule) =>
          rule.subject === 'Config' &&
          rule.action === 'read' &&
          JSON.stringify(rule.conditions).includes('Config:Permissions'),
      ),
    ).toBe(true);
  });

  it('should report unchanged when the managed rules are already present', () => {
    const { merged } = mergeSection([adminRule]);

    const second = mergeSection(merged);

    expect(second.changed).toBe(false);
    expect(second.merged).toEqual(merged);
    expect(second.dropped).toEqual([]);
  });

  it('should strip the managed rules again when no admin rule is left', () => {
    // public forms are no longer used: anonymous visitors must not keep
    // read access that was only granted to support them
    const inUse = mergeSection([adminRule]).merged;

    const noLongerUsed = mergeSection(inUse.slice(0, -1));

    expect(noLongerUsed.changed).toBe(true);
    expect(noLongerUsed.merged).toEqual([]);
  });

  it('should leave an existing but empty _public section empty', () => {
    const result = mergeSection([]);

    expect(result.changed).toBe(false);
    expect(result.merged).toEqual([]);
  });
});
