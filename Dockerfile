# syntax=docker/dockerfile:1

# Builds two images from one file: `api` (the Node server) and `web` (Caddy serving the built
# frontend and proxying the API). docker-compose.yml picks each with `target`.

FROM node:24-alpine AS deps
WORKDIR /app
RUN npm install --global pnpm@11
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
RUN pnpm build

FROM deps AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=prod-deps /app/node_modules node_modules
COPY server server
COPY shared shared
# The page shell that saved-trip links get with their results inlined.
COPY --from=build /app/dist/index.html dist/index.html
# A new named volume copies this directory's owner, so the server can write its database there.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/main.ts"]

FROM caddy:2-alpine AS web
# The official binary carries a file capability for binding ports below 1024, and with every
# capability dropped the kernel refuses to run a binary that asks for one. This one listens on
# 8080, so the capability is removed instead of granted.
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
USER 1000:1000
