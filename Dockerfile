FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/cli/package.json ./packages/cli/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/mcp ./packages/mcp
RUN npm run build -w packages/mcp && npm prune --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/packages/mcp/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/mcp/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "dist/remote/server.js"]
