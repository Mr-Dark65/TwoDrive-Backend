# Simple production-ready Dockerfile for Node.js Express app
FROM node:20-alpine AS base

# Create app directory
WORKDIR /app

# Install dependencies (only production)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY . .

# Expose port (configurable via PORT env; default 3001)
EXPOSE 3001

# Set NODE_ENV for production
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
