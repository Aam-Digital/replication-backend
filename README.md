[![Maintainability](https://api.codeclimate.com/v1/badges/f64d334dac765d672119/maintainability)](https://codeclimate.com/github/Aam-Digital/replication-backend/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/f64d334dac765d672119/test_coverage)](https://codeclimate.com/github/Aam-Digital/replication-backend/test_coverage)

# Replication Backend

This backend service is can be used to filter the replication between a PouchDB and a CouchDB instance based on permission rules.


## Setup
This API functions as a proxy layer between a client and a standard CouchDB instance.
Configure the CouchDB running as the backend database through the environment variable (or the .env file).
