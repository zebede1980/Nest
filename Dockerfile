# ─── Builder ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop the build-only dependencies from node_modules.
RUN npm prune --omit=dev

# ─── Runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TZ=Europe/London

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server ./dist-server
# `docker exec -it nest nest ...` manages accounts and checks nudges.
COPY --chmod=755 bin/nest /usr/local/bin/nest

# /app/data holds the SQLite database (nest.db), including the push keys.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# node:sqlite is still flagged experimental in Node 22; it works, so hush the warning.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/server/src/index.js"]
