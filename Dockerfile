FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run contracts:build && npm run build

FROM node:24.18.0-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.local/documents && chown -R node:node /app/.local
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
