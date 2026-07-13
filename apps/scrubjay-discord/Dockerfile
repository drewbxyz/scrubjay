# Base stage: Set up Node.js and pnpm
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
# pnpm 11 installs global bins to $PNPM_HOME/bin (older pnpm used $PNPM_HOME)
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat && \
    corepack enable && \
    pnpm install turbo --global

FROM base AS builder
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml* ./
COPY . .
RUN turbo prune scrubjay-discord --docker

FROM base AS installer
WORKDIR /usr/src/app
COPY .gitignore .gitignore
COPY --from=builder /usr/src/app/out/json/ .
COPY --from=builder /usr/src/app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /usr/src/app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /usr/src/app/out/full/ .

RUN pnpm install --frozen-lockfile
COPY turbo.json turbo.json
RUN turbo run build --filter=scrubjay-discord

FROM node:22-alpine AS runner

WORKDIR /usr/src/app
 
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs
 
# Copy root workspace files and node_modules (contains hoisted dependencies)
COPY --from=installer --chown=nodejs:nodejs /usr/src/app/package.json ./package.json
COPY --from=installer --chown=nodejs:nodejs /usr/src/app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=installer --chown=nodejs:nodejs /usr/src/app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=installer --chown=nodejs:nodejs /usr/src/app/node_modules ./node_modules

# Copy the entire app directory (includes dist, node_modules, and source files like drizzle migrations)
COPY --from=installer --chown=nodejs:nodejs /usr/src/app/apps/scrubjay-discord ./apps/scrubjay-discord

# Workspace packages: the app's node_modules links @scrubjay/* as relative
# symlinks into ../../packages, so they must exist in the image or the
# require() dangles and the bot dies at boot with MODULE_NOT_FOUND.
COPY --from=installer --chown=nodejs:nodejs /usr/src/app/packages ./packages
 
USER nodejs
WORKDIR /usr/src/app/apps/scrubjay-discord

# Single quotes are load-bearing: backticks or ${...} in double quotes would
# be expanded by /bin/sh before node runs. start-period covers migrations +
# Discord login. Alpine has no curl; node 22's global fetch does the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT ?? 3000) + "/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "dist/main.js"]