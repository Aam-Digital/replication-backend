# This docker image can be used to run the service.
# To use it only Docker needs to be installed locally
# Run the following commands from the root folder to build, run and kill the application
# >> docker build -f build/Dockerfile -t replication-ms:latest .
# >> docker run -p=80:80 replication-ms:latest
FROM node:16.13.0-alpine3.13 as builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-progress

COPY . .

RUN npm run build

# When set to true, tests are run and coverage will be uploaded to CodeClimate
ARG UPLOAD_COVERAGE=false
RUN if [ "$UPLOAD_COVERAGE" = true ] ; then \
    apk --no-cache add curl &&\
    curl -L https://codeclimate.com/downloads/test-reporter/test-reporter-latest-linux-amd64 > ./cc-test-reporter &&\
    chmod +x ./cc-test-reporter &&\
    ./cc-test-reporter before-build ; fi

# If set to true, tests are exectued
ARG RUN_TESTS=false

# Lint code and run tests
RUN if [ "$RUN_TESTS" = true ] || [ "$UPLOAD_COVERAGE" = true ] ; then \
    npm run lint &&\
    npm run test:cov ; fi

# The following arguments need to be provided for the code climate test reporter to work correctly
# The commit sha
ARG GIT_COMMIT_SHA
# The branch
ARG GIT_BRANCH
# The time of the commit, can be extracted with `git log -1 --pretty=format:%ct`
ARG GIT_COMMITTED_AT
# The ID for the test reporter, can be found on CodeCoverage
ARG CC_TEST_REPORTER_ID
RUN if [ "$UPLOAD_COVERAGE" = true ] ; then ./cc-test-reporter after-build --debug ; fi

FROM node:16.13.0-alpine3.13
WORKDIR /app
# Some packages enable optimization when this is set
ENV NODE_ENV="production"

COPY package*.json ./
RUN npm ci --no-progress --only=production

COPY --from=builder /app/dist ./dist

# The url of the CouchDB instance
ENV DATABASE_URL="http://localhost:5984"
# The user credentials which can access ALL data on the database
ENV DATABASE_USER="demo"
ENV DATABASE_PASSWORD="pass"
# database name where the permissions definition document is stored
ENV PERMISSION_DB="app"
# A secret which is used to generate the cookies for user authentication
ENV JWT_SECRET="jwtSecret"
# (optional) The sentry DSN in order to send the error messages to sentry
ENV SENTRY_DSN=""

CMD ["node", "dist/main"]

