# Stage 1: build TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# Install root deps (needed for netlify/functions imports)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Install server-specific deps
COPY server/package.json ./server/
RUN cd server && npm ci --ignore-scripts

# Copy source
COPY server/ ./server/
COPY netlify/functions/ ./netlify/functions/

# Compile
RUN cd server && npm run build

# Stage 2: runtime
FROM node:20-alpine

WORKDIR /app

# Only production deps
COPY server/package.json ./server/
RUN cd server && npm ci --only=production --ignore-scripts

# Copy compiled output
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server/server.js"]
