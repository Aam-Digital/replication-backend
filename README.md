[![Maintainability](https://qlty.sh/gh/Aam-Digital/projects/replication-backend/maintainability.svg)](https://qlty.sh/gh/Aam-Digital/projects/replication-backend)
[![Code Coverage](https://qlty.sh/gh/Aam-Digital/projects/replication-backend/coverage.svg)](https://qlty.sh/gh/Aam-Digital/projects/replication-backend)

# Replication Backend

This backend service can be used to filter the replication between a [PouchDB](https://pouchdb.com/) and a [CouchDB](https://docs.couchdb.org/en/stable/index.html) instance based on permission rules.
It does this by overriding some of CouchDB`s endpoints where permissions are checked on the transmitted entities.
The permission rules are defined through [CASL](https://casl.js.org/v5/en/).

## Setup

This API functions as a proxy layer between a client (PouchDB) and a standard CouchDB instance.
The backend can either be run as a docker container

```
> docker run aamdigital/replication-ms:latest
```

or directly through npm (see below: --> "Development")

```
> npm install && npm start
```

In both cases the following environment variables should be defined:

- `DATABASE_URL` the URL where the CouchDB instance can be accessed
- `DATABASE_USER` the name of a user that is a `member` of all databases inside the CouchDB instance. In case the proxy is also used to create new entries in the `_users` database, then this user needs to be `admin` in this database.
- `DATABASE_PASSWORD` the password for the `DATABASE_USER`
- `PERMISSION_DB` the database name where the permissions definition document is stored
- `JWT_SECRET` a secret to create JWT tokens. They are used in the JWT auth which works similar to CouchDB's `POST /_session` endpoint. This should be changed to prevent others to create fake JWT tokens.
- `JWT_PUBLIC_KEY` the public key which can be used to validate a JWT in the authorization header (bearer). The structure is the same as and compatible with [CouchDB JWT auth](https://docs.couchdb.org/en/stable/api/server/authn.html#jwt-authentication).
- `SENTRY_DSN` (optional) the [Sentry DSN](https://docs.sentry.io/product/sentry-basics/dsn-explainer/). If defined, error messages are sent to the sentry.io application monitoring & logging service.
  - `SENTRY_TRACES_SAMPLE_RATE` (optional) decimal value between `0.0` and `1.0` controlling transaction tracing volume in Sentry. Defaults to `0.02` (2%) to limit ingestion costs.
- `KEYCLOAK_ADMIN_BASE_URL` (optional) the base URL of the Keycloak server (e.g. `https://keycloak.example.com`). Required to enable the `/api/v1/permissions/check` endpoint, which resolves user roles via the Keycloak Admin API. If not set, the endpoint returns a 502 error but all other functionality continues to work.
- `KEYCLOAK_REALM` (optional, required together with `KEYCLOAK_ADMIN_BASE_URL`) the Keycloak realm name.
- `KEYCLOAK_ADMIN_CLIENT_ID` (optional, required together with `KEYCLOAK_ADMIN_BASE_URL`) the Keycloak client ID used to authenticate against the Keycloak Admin API.
- `KEYCLOAK_ADMIN_CLIENT_SECRET` (optional, required together with `KEYCLOAK_ADMIN_BASE_URL`) the client secret for `KEYCLOAK_ADMIN_CLIENT_ID`.
  When `KEYCLOAK_ADMIN_BASE_URL` uses HTTPS with a self-signed CA (e.g. the local Caddy proxy), set `NODE_EXTRA_CA_CERTS` to the CA cert path before starting Node (see the local dev section below).

In case the backend is run through Docker, the args can be provided like this

```
> docker run -e DATABASE_URL=https://test.com/couchdb -e DATABASE_USER=replicator -e DATABASE_PASSWORD=securePassword -e JWT_SECRET=myJWTSecret -e JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nSomePublicKey\n-----END PUBLIC KEY-----" aamdigital/replication-ms:latest
```

In case the backend is run through npm, the `.env` file can be adjusted.

## Defining Permissions

See our [Developer Documentation](https://aam-digital.github.io/ndb-core/documentation/additional-documentation/concepts/user-roles-and-permissions.html)

### Startup behavior of the permission service

`RulesService` loads the `Config:Permissions` document from the database
configured via `PERMISSION_DB` during startup. Its behavior is fail-closed:

- **Success:** the loaded rules are applied to all subsequent requests.
- **CouchDB returns 401 / 403:** the configured `DATABASE_USER` /
  `DATABASE_PASSWORD` are wrong. Startup is **aborted** with a `CRITICAL` log
  message — the service refuses to start without a way to evaluate
  permissions.
- **CouchDB returns 404 (permission document missing):** the service enters
  **bootstrap mode**. A synthesized config grants `manage all` to users with
  the `admin_app` role only; every other user (including anonymous traffic)
  is denied. This lets an administrator sign in and seed the real
  `Config:Permissions` document, after which the live changes feed swaps in
  the real rules and triggers a `clearLocal` so all clients re-sync.
- **Network error / 5xx / malformed response:** the load is retried with
  exponential backoff (1s → 2s → 4s → 8s → 10s, capped) for up to 60s. If
  the live changes feed delivers a config during a backoff, the loop exits
  early. If the budget is exhausted, startup is aborted with a `CRITICAL`
  log.
- **Defense in depth:** if `getRulesForUser` is ever called with no config
  loaded (which should be unreachable given the above), it returns an empty
  rule set and CASL denies every action.

## Operation

Besides the CouchDB endpoints, the backend also provides some additional endpoints that are necessary to be used at times.
A swagger / OpenAPI interface can be visited at `/api/` which shows all endpoints that are available.

- `/admin/clear_local/{db}` needs to be executed whenever a rule or a permission change might give a user more permission than the user previously had. This will restart the synchronization process for each client which makes them fetch all the documents for which they now have gained permissions.
- The endpoints of the _real_ CouchDB are available through a reverse proxy at `/couchdb/`. This can be used to visit the developer interface at `/couchdb/_utils/`.

Additionally, a separate check on the client side is necessary that cleans up the local database whenever a client looses read permissions for a document.
A example for how this could look can be found [here](https://github.com/Aam-Digital/ndb-core/blob/master/src/app/core/permissions/permission-enforcer/permission-enforcer.service.ts).

## Audit / Changelog Recording

The backend can record a tamper-resistant change log of every entity write, so
that "what changed, by whom and when" can be reconstructed for audit/legal
purposes (see [issue #4026](https://github.com/Aam-Digital/ndb-core/issues/4026)).

Because the proxy holds the authenticated Keycloak identity at write time and
sees every revision a client pushes, it is the right place to record this: the
"who" and the server-set timestamp are trustworthy, and conflicting branches
from concurrent/multi-device edits are captured.

### How it works

- Enabled via the `AUDIT_ENABLED` environment variable (default `false`). When
  disabled the feature is a complete no-op — no behavior change on any write path.
- On each successful write (bulk `_bulk_docs` replication, single `PUT`, and
  `DELETE`), one record is written to a separate database derived from the
  source db name: writes to `app` are recorded in `app-audit`. The convention
  is hard-wired, and each `<db>-audit` database is auto-created on first write.
- Each record's `_id` is `ChangeAudit:<entityId>:<ISO-timestamp>:<rev>`. The
  `ChangeAudit:` prefix is load-bearing: the proxy derives the CASL subject from
  the `_id` prefix (`detectDocumentType` = `_id.split(':')[0]`), so audit records
  are classified as the dedicated subject `ChangeAudit` — not as the source
  entity (`Child`, ...). This is what keeps them un-forgeable and governed by a
  single rule (see Protection).
- A record contains: the changed `entityId`, source `database`, `operation`
  (`create` / `update` / `delete` / `baseline`), the new `rev` and its
  `parentRev`, a **server-set** `timestamp`, the **authenticated** `user`
  (`{ id, name, roles }`), and a [`jsondiffpatch`](https://www.npmjs.com/package/jsondiffpatch)
  `diff` of the change. The client's local `_updatedAt`/`_updatedBy` are kept
  inside the diff; only internal CouchDB noise (`_rev`, `_revisions`,
  `_conflicts`, `_attachments`) is excluded.
- **Seamless activation:** the first change to an entity that has no prior audit
  record additionally emits a full-snapshot `baseline` record, so history is not
  lost when the feature is switched on for an existing system. No migration is
  needed.

### Protection (read-only via the permission engine)

There is no dedicated guard. The `<db>-audit` database is reachable through the
normal proxy and governed entirely by CASL on the `ChangeAudit` subject:

- The system's own audit writes use the proxy's admin credentials and are
  written **directly** to CouchDB via `CouchdbService`, bypassing the
  permission-checked endpoints — so recording always succeeds.
- Any **client** write that targets a `ChangeAudit:` document (to the audit DB
  _or_ a forged one in the main app DB) is dropped, because no rule grants
  `create`/`update`/`delete` on `ChangeAudit`. Rules are global (keyed on the
  subject, not the DB name), so this holds across `_bulk_docs` / `_all_docs` /
  `_changes` / `_bulk_get` / `_find`.
- A client **read** of audit records is allowed only where a
  `{ subject: "ChangeAudit", action: "read" }` rule is granted (the proxy filters
  reads via `ability.can('read', doc)`). This is what lets the history-viewing UI
  read the audit DB as an ordinary read-only remote database.

> **Where the read rule lives:** the `ChangeAudit` read rule is part of the
> application's permission config (the `Config:Permissions` document managed in
> ndb-core), granted to privileged roles only — not hard-coded here. Without it,
> the audit DB is invisible and immutable to clients (default-deny), which is the
> safe default.
>
> **Documented trade-off:** whole-document read rules do not strip individual
> fields, so a user permitted to read an audit record sees the entire diff, and
> read permission is coarse (the single `ChangeAudit` subject). Mitigation: grant
> the read rule only to privileged roles who already see full records.
> Field-level redaction would require a bespoke read endpoint instead.

### Known limitation

Only revisions _pushed_ by clients are captured. PouchDB sends only **leaf**
revisions with their ancestry, so intermediate same-device/offline edits never
reach the backend and cannot be audited by any backend component. The genuine
guarantee is conflict-branch capture and a trustworthy authenticated author and
server timestamp — not a complete per-keystroke history.

# Development

This system is Node.js application built with the [NestJS](https://nestjs.com/) framework.

To run and test this project locally:

1. `npm install` to download and set up all dependencies
2. `npm start` to run the application locally (see above for required environment variables)
3. `npm test` to execute unit tests

## Using with the aam-services docker stack

Run this service locally while the rest of the stack runs in Docker:

1. Start the docker stack (follow the setup guide):
   <https://github.com/Aam-Digital/aam-services/tree/main/docs/developer>
2. Configure local env in this repo:
   - `cp .env.template .env`
   - Set `JWT_PUBLIC_KEY` from `https://keycloak.localhost/realms/dummy-realm`
   - Set `KEYCLOAK_ADMIN_CLIENT_SECRET` from the Keycloak client credentials
3. Trust the Caddy self-signed CA for HTTPS calls to `keycloak.localhost`:

   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/aam-services/docs/developer/container-data/caddy-authorities/root.crt
   ```

4. Start replication-backend locally (port 3000):
   - `npm start`
5. Route `/db` to the local service:
   - In `aam-services/docs/developer/Caddyfile`, enable:
     `reverse_proxy http://host.docker.internal:3000`
   - Restart Caddy:
     `cd aam-services/docs/developer && docker compose restart reverse-proxy`

Notes:

- Keep the local replication-backend running; Caddy forwards `/db*` to it.
- Ensure no replication-backend container is running when using the local service.

## Run in a fully local environment with other services

Use the dockerized local environment to run a fully synced app including backend services on your machine:
<https://github.com/Aam-Digital/aam-services/tree/main/docs/developer>
