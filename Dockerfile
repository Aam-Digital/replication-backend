FROM node:20-alpine

USER node

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

# Some packages enable optimization when this is set
ENV NODE_ENV="production"

RUN npm ci

COPY --chown=node:node . .

RUN npm run build

# The url of the CouchDB instance
ENV DATABASE_URL="http://localhost:5984"
# The user credentials which can access ALL data on the database
ENV DATABASE_USER="demo"
ENV DATABASE_PASSWORD="pass"
# database name where the permissions definition document is stored
ENV PERMISSION_DB="app"
# A secret which is used to generate the cookies for user authentication
ENV JWT_SECRET="jwtSecret"
# The public key for verifying JWTs
ENV JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n<PUBLIC_KEY>\n-----END PUBLIC KEY-----"
# (optional) The sentry DSN in order to send the error messages to sentry
ENV SENTRY_DSN=""
# (optional) Port under which the app can be accessed. Default is 3000
ENV PORT=""

# Start the server using the production build
CMD [ "node", "dist/main.js" ]
