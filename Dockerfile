FROM node:24-alpine AS builder

USER node

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci

COPY --chown=node:node . .

RUN npm run build

FROM node:24-alpine AS runtime

USER node

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

# Some packages enable optimization when this is set
ENV NODE_ENV="production"

# Install only production dependencies in the final image.
RUN npm ci --omit=dev

COPY --from=builder --chown=node:node /usr/src/app/dist ./dist

# Runtime configuration (including secrets) must be provided externally,
# e.g. via `docker run -e ...`, docker compose, or your orchestrator.

# Start the server using the production build
CMD ["node", "dist/main.js"]