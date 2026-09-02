# Build context is the repo root (npm workspaces need the root lockfile):
#   docker build -f apps/api/Dockerfile .

FROM node:20-slim AS builder
WORKDIR /app
# Prisma's query engine needs a matching OpenSSL on the base image, or it
# silently guesses wrong and fails to connect at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=apps/api

COPY apps/api apps/api
RUN npm run prisma:generate --workspace=apps/api
RUN npm run build --workspace=apps/api

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json

# node:*-slim images ship a non-root "node" user (uid 1000) — nothing here
# needs root, and running the container as root by default was never an
# intentional choice, just the base image's default left unchanged.
USER node

# Cloud Run injects PORT (defaults to 8080); main.ts already reads process.env.PORT.
EXPOSE 8080
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
