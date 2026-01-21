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

In case the backend is run through Docker, the args can be provided like this
```
> docker run -e DATABASE_URL=https://test.com/couchdb -e DATABASE_USER=replicator -e DATABASE_PASSWORD=securePassword -e JWT_SECRET=myJWTSecret -e JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nSomePublicKey\n-----END PUBLIC KEY-----" aamdigital/replication-ms:latest
```
In case the backend is run through npm, the `.env` file can be adjusted.

## Defining Permissions

See our [Developer Documentation](https://aam-digital.github.io/ndb-core/documentation/additional-documentation/concepts/user-roles-and-permissions.html)

## Operation
Besides the CouchDB endpoints, the backend also provides some additional endpoints that are necessary to be used at times.
A swagger / OpenAPI interface can be visited at `/api/` which shows all endpoints that are available.
- `/admin/clear_local/{db}` needs to be executed whenever a rule or a permission change might give a user more permission than the user previously had. This will restart the synchronization process for each client which makes them fetch all the documents for which they now have gained permissions.
- The endpoints of the *real* CouchDB are available through a reverse proxy at `/couchdb/`. This can be used to visit the developer interface at `/couchdb/_utils/`.

Additionally, a separate check on the client side is necessary that cleans up the local database whenever a client looses read permissions for a document.
A example for how this could look can be found [here](https://github.com/Aam-Digital/ndb-core/blob/master/src/app/core/permissions/permission-enforcer/permission-enforcer.service.ts).


# Development
This system is Node.js application built with the [NestJS](https://nestjs.com/) framework.

To run and test this project locally:
1. `npm install` to download and set up all dependencies
2. `npm start` to run the application locally (see above for required environment variables)
3. `npm test` to execute unit tests

## Using with the aam-services docker stack
Run this service locally while the rest of the stack runs in Docker:

1. Start the docker stack (follow the setup guide):
   https://github.com/Aam-Digital/aam-services/tree/main/docs/developer
2. Configure local env in this repo:
   - `cp .env.template .env`
   - Set `JWT_PUBLIC_KEY` from `https://keycloak.localhost/realms/dummy-realm`
3. Start replication-backend locally (port 3000):
   - `npm start`
4. Route `/db` to the local service:
   - In `aam-services/docs/developer/Caddyfile`, enable:
     `reverse_proxy http://host.docker.internal:3000`
   - Restart Caddy:
     `cd aam-services/docs/developer && docker compose restart reverse-proxy`

Notes:
- Keep the local replication-backend running; Caddy forwards `/db*` to it.
- Ensure no replication-backend container is running when using the local service.

## Run in a fully local environment with other services
Use the dockerized local environment to run a fully synced app including backend services on your machine:
https://github.com/Aam-Digital/aam-services/tree/main/docs/developer
