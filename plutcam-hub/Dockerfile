# plutcam-hub Dockerfile
# Simple production image

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Use the built-in 'node' user (uid/gid 1000 in official images)

COPY --from=deps /app/node_modules ./node_modules
COPY server.mjs ./server.mjs
COPY public ./public

# runtime data dir
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 1212
ENV PORT=1212
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

CMD ["node", "server.mjs"]
