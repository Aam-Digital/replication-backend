# This docker image can be used to run the service.
# To use it only Docker needs to be installed locally
# Run the following commands from the root folder to build, run and kill the application
# >> docker build -f build/Dockerfile -t replication:latest .
# >> docker run -p=80:80 replication:latest
FROM node:16.7.0-alpine3.14
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-progress

# When set to true, tests are run and coverage will be uploaded to CodeClimate
ARG UPLOAD_COVERAGE=false
RUN if [ "$UPLOAD_COVERAGE" = true ] ; then \
    apk --no-cache add curl &&\
    curl -L https://codeclimate.com/downloads/test-reporter/test-reporter-latest-linux-amd64 > ./cc-test-reporter &&\
    chmod +x ./cc-test-reporter &&\
    ./cc-test-reporter before-build ; fi

# When set to true, chromium is installed an tests are executed
ARG RUN_TESTS=false
ARG CHROME_BIN=/usr/bin/chromium-browser
# Install chromium for karma, lint code and run tests

COPY . .

RUN if [ "$RUN_TESTS" = true ] || [ "$UPLOAD_COVERAGE" = true ] ; then \
    npm run lint &&\
    npm test ; fi

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

