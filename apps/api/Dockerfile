# Build context is the repo root (npm workspaces need the root lockfile):
#   docker build -f apps/api/Dockerfile .

FROM node:20-slim AS builder
WORKDIR /app

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

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

# Cloud Run injects PORT (defaults to 8080); main.ts already reads process.env.PORT.
EXPOSE 8080
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
