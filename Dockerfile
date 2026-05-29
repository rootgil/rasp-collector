FROM node:22-alpine AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Build: install all deps, generate the Prisma client, compile, then prune to
# production deps. Generation and pruning happen in the SAME node_modules so the
# generated client (node_modules/.pnpm/.../.prisma) stays consistent with pnpm's
# store layout — copying it across stages with --prod would mismatch the hash.
FROM base AS build
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate
RUN pnpm build
RUN pnpm prune --prod

# Runtime
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 4000
CMD ["node", "dist/server.js"]
