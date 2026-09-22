# AI Agent Instructions

CouchDB replication and permission proxy for [Aam Digital](https://github.com/Aam-Digital/ndb-core).
See README.md for setup and development details.

## Comments and README Style

Keep code comments and README explanations brief and high-level: state what's
non-obvious in a sentence or two, not a step-by-step walkthrough of the
mechanism — implementation details belong in the code itself, not in prose
describing it. Don't reference another repository's internals (e.g.
ndb-setup's setup scripts, a Helm chart) — this repo's code and docs should
stand on their own, and details owned elsewhere go stale here without anyone
noticing.

## Public GitHub Content (PRs, Issues, Comments, Commit Messages)

This repository is public. Never include customer/project-identifying information or other
production-system-specific data in anything posted to GitHub — no deployment/instance names,
server hostnames, external partner URLs, user identifiers, or real record data. Share only
generalized insights instead (e.g. "a large production instance", "an external webhook
consumer"). Scrub quoted log or monitoring output before posting. Links to access-restricted
internal tools (e.g. Sentry issues) are acceptable.

## Writing Readable Unit Tests

Spec files for a service with several branches/checks tend to grow into 400+ lines of
copy-pasted mocks, which makes them hard to review. Keep them short by attacking the
boilerplate, not just the test count:

- **One parameterized stub builder per spec file**, not a hand-rolled `mockImplementation`
  per test. Give it happy-path defaults and let each test override only what it cares about
  (e.g. `stubCouchdb({ requireValidUser: 'unset' })`).
- **Hoist repeated spy/mock setup into `beforeEach`** (e.g. `Logger` spies) instead of
  recreating it in every `it`.
- **Collapse near-identical cases into `it.each` tables** when several tests differ only in
  the input and the expected message/value (e.g. four variants of "a permissive `_security`
  document logs CRITICAL"). Keep a case as its own dedicated `it` only when it exercises a
  genuinely distinct code path (e.g. proving a loop checks _both_ dbs, not just the first).
- **Group related checks under `describe` blocks** so the suite's structure mirrors the
  service's structure.
- **Don't assert what the test runner already asserts.** `await service.onModuleInit()`
  already fails the test if it throws — an `await expect(...).resolves.toBeUndefined()`
  wrapper only earns its keep where "resolves rather than throwing" is itself the behavior
  under test (e.g. a check that must fail open, not closed).
- **Keep every case that guards a real, non-obvious behavior**, even a one-line one — don't
  cut coverage just to shrink the file. Cutting boilerplate should do most of the work; only
  trim actual test cases where two of them exercise the exact same branch.
- **After trimming, verify with mutation-style spot checks**: temporarily break the specific
  behavior a suspect test claims to cover (e.g. widen a strict equality check, flip a boolean)
  and confirm the expected tests fail, then revert. A test that stays green either way isn't
  covering what its name says.
