FROM node:20-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY server/ ./server/
COPY public/ ./public/

# Create data directory
RUN mkdir -p /app/data

# Expose port 4000
EXPOSE 4000

# Mount point for persistent data
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/settings || exit 1

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

CMD ["node", "server/index.js"]
