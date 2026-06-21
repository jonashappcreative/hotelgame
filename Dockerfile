# Stage 1: build backend TypeScript + Vite frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install root deps (Vite, React, Tailwind, etc.)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Install server-specific deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --ignore-scripts

# Copy backend + shared function source
COPY server/ ./server/
COPY netlify/functions/ ./netlify/functions/

# Build backend TypeScript → dist/server/
RUN cd server && npm run build

# Copy frontend source
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.app.json ./
COPY tsconfig.node.json ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./

# Build Vite frontend → dist/ (VITE_WS_URL baked in at build time)
ARG VITE_WS_URL=wss://hotelgame.jonashapp.com
RUN VITE_WS_URL=$VITE_WS_URL npm run build

# Stage 2: runtime
FROM node:20-alpine

WORKDIR /app

# Install production deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled backend (dist/server/) + built frontend (dist/index.html, dist/assets/)
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server/server.js"]
