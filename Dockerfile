# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Expose Vite's default port
EXPOSE 5173

# Start development server with host flag for Docker
# CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]