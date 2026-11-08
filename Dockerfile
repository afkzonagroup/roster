# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
#
# Roster CLI image. No runtime dependencies, runs as an unprivileged user,
# needs no network. Usage:
#   docker build -t roster .
#   docker run --rm --network none --cap-drop=ALL --security-opt no-new-privileges \
#     --read-only -v "$PWD:/work" roster validate register

FROM node:22.23.4-alpine3.24@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22.23.4-alpine3.24@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json LICENSE LICENSE-ADDITIONAL-TERMS.md ./
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S roster && adduser -S -G roster -H -s /sbin/nologin roster \
    && mkdir -p /work && chown roster:roster /work
USER roster
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli/main.js"]
CMD ["--help"]
