# syntax=docker/dockerfile:1

# ---- Base ----------------------------------------------------------------
# Prisma 7 requires Node >= 22.12. Pin a slim, current LTS image.
FROM node:22-slim AS base
WORKDIR /app
# OpenSSL is required by Prisma's query engine at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# ---- Dependencies --------------------------------------------------------
# Install ALL deps (incl. dev) for the build stage.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ---------------------------------------------------------------
FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
# Generate the Prisma client, compile TS, and copy .hbs/.json templates to dist.
RUN npx prisma generate
RUN npm run build

# ---- Production dependencies --------------------------------------------
# A clean install of only production deps for a smaller runtime image.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
# The Prisma client must be generated against the production node_modules too.
RUN npx prisma generate

# ---- Runtime -------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# Non-root user for safety.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nodejs
EXPOSE 4000

# Entrypoint runs pending DB migrations, then starts the server.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
