# Stage 1: build backend TypeScript + Vite frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install root deps (Vite, React, Tailwind, etc.)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Install server-specific deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --ignore-scripts

# Copy all source (backend, shared functions, frontend)
COPY server/ ./server/
COPY netlify/functions/ ./netlify/functions/
COPY src/ ./src/
COPY public/ ./public/
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tailwind.config.ts postcss.config.js ./

# Build frontend FIRST. `vite build` empties dist/ before writing, so it MUST
# run before the backend compile — otherwise it would wipe dist/server/server.js.
# VITE_WS_URL is baked into the JS bundle at build time.
ARG VITE_WS_URL=wss://hotelgame.jonashapp.com
RUN VITE_WS_URL=$VITE_WS_URL npm run build

# Build backend SECOND. tsc writes dist/server/ + dist/netlify/ WITHOUT emptying
# dist/, so the frontend output from the previous step survives intact.
RUN cd server && npm run build

# Stage 2: runtime
FROM node:20-alpine

WORKDIR /app

# Install production deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy everything built above:
#   dist/server/server.js   ← backend entry
#   dist/netlify/functions/ ← shared API handlers
#   dist/index.html, dist/assets/ ← Vite frontend
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server/server.js"]
