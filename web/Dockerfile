# Zekra console (Next standalone) for Hosbah. Build context: the repo root, since next.config
# bundles ../docs into content/site/docs.gen.json at build time. Next bakes its rewrites at build
# time, so API_ORIGIN (where /api, /events and /graphql go) is a build argument.
FROM node:24-bookworm-slim AS build
ARG API_ORIGIN=http://zekra-api:8080
ENV API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY docs/ /src/docs/
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3020 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /src/web/.next/standalone ./
COPY --from=build /src/web/.next/static ./.next/static
COPY --from=build /src/web/public ./public
EXPOSE 3020
CMD ["node", "server.js"]
