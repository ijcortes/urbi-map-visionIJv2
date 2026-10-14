FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ARG VITE_API_URL
ARG VITE_MAPBOX_TOKEN
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_SENTRY_DSN
ARG RAILWAY_GIT_COMMIT_SHA
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_BUILD_ID=$RAILWAY_GIT_COMMIT_SHA

# Fail the build instead of shipping a site that silently points at the wrong/no API or has no map.
RUN test -n "$VITE_API_URL" && test -n "$VITE_MAPBOX_TOKEN" || (echo "ERROR: build args VITE_API_URL and VITE_MAPBOX_TOKEN are required" >&2 && exit 1)

RUN npm run build

# TanStack Start SSR build doesn't copy public/ subdirectories to dist/client/
# Copy entire public/data directory (not glob) to ensure all file types including .geojson
RUN cp -r public/data dist/client/data

ENV NODE_ENV=production
EXPOSE 8080

# Run unprivileged. server.mjs only READS /app (dist, public) and listens on a
# port > 1024, so no write access or capabilities are needed. `node` (uid 1000)
# ships with the official node image.
USER node

CMD ["node", "/app/server.mjs"]
