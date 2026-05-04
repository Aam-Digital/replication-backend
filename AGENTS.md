# Agent Instructions

This file provides guidance for AI coding agents working on the **replication-backend** repository.

## Project Overview

This is a [NestJS](https://nestjs.com/) backend service (Node.js / TypeScript) that acts as a
permission-aware proxy between a [PouchDB](https://pouchdb.com/) client and a
[CouchDB](https://docs.couchdb.org/) instance.
Permissions are enforced using [CASL](https://casl.js.org/).
Error monitoring is provided by [Sentry](https://sentry.io/).

Key source directories:

| Path | Purpose |
|---|---|
| `src/` | Application source code |
| `src/auth/` | Authentication (JWT, Basic, Cookie) |
| `src/permissions/` | CASL permission rules and evaluation |
| `src/restricted-endpoints/` | Proxied CouchDB endpoints with permission checks |
| `src/couchdb/` | CouchDB HTTP client service |
| `src/admin/` | Admin-only endpoints (e.g. `clear_local`) |
| `src/config/` | App configuration loaded from `app.yaml` and `.env` |
| `src/sentry.configuration.ts` | Sentry initialisation |
| `test/` | End-to-end tests |

## Development Commands

```bash
npm install          # install dependencies
npm start            # run locally (requires .env)
npm run build        # compile TypeScript
npm test             # run unit tests (Jest)
npm run test:e2e     # run end-to-end tests
npm run test:cov     # run unit tests with coverage report
npm run lint         # lint and auto-fix with ESLint + Prettier
npm run format       # format source files with Prettier
```

Copy `.env.template` to `.env` and fill in the required values before running locally.
See `README.md` for a full description of every environment variable.

## Testing

### Unit tests

Unit tests live next to the source files and follow the `*.spec.ts` naming convention
(e.g. `src/permissions/rules/rules.service.spec.ts`).

Patterns used across the codebase:

- Use `@nestjs/testing` (`Test.createTestingModule`) to build an isolated NestJS module.
- Provide mock dependencies via `{ provide: SomeService, useValue: mockService }`.
- Use `jest.spyOn` to control return values and verify calls.
- Import `authGuardMockProviders` from `src/auth/auth-guard-mock.providers` to bypass guards in
  controller tests.

### End-to-end tests

E2E tests live in `test/` and use [Supertest](https://github.com/ladjs/supertest) against the full
NestJS application (`test/app.e2e-spec.ts`).
Run them with `npm run test:e2e`.

## MCP Servers

The following MCP (Model Context Protocol) servers are available and should be used for the tasks
described below.

### GitHub MCP

Use the **GitHub MCP server** when you need to:

- Read or search issues and pull requests.
- Post comments on issues or PRs.
- Inspect CI/workflow run results and logs.
- Query repository metadata (branches, tags, releases).

### Sentry MCP

Use the **Sentry MCP server** when you need to:

- Look up error events or issues captured in the production or staging Sentry project.
- Investigate stack traces and breadcrumbs to understand the root cause of a bug.
- Correlate a user-reported error with a specific Sentry event before making code changes.

Sentry is initialised in `src/sentry.configuration.ts`.
The DSN and related settings are configured through environment variables
(`SENTRY_DSN`, `SENTRY_ENABLED`, `SENTRY_ENVIRONMENT`, `SENTRY_INSTANCE_NAME`).
See `.env.template` and `src/config/app.yaml` for defaults.

## Architecture Notes

- The service overrides selected CouchDB endpoints (`_bulk_docs`, `_changes`, `_all_docs`, etc.)
  to filter documents based on the requesting user's CASL rules.
- Permission rules are stored as documents in a dedicated CouchDB database (`PERMISSION_DB`).
  They are loaded and cached by `RulesService`, which watches for changes via the `_changes` feed.
- The `_changes` endpoint is extended with a `lostPermissions` array so that clients know which
  documents to purge locally when they lose read access.
- Authentication supports JWT (bearer token), HTTP Basic, and cookie-based sessions.
- CouchDB is also exposed as a transparent reverse proxy at `/couchdb/` for admin tooling.
- The Swagger/OpenAPI UI is available at `/api/`.
