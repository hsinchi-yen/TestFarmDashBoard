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

# The official Node image already provides node:node as UID/GID 1000:1000.
# Keep that identity so bind-mounted production data owned by 1000:1000 remains
# writable while the application still runs without root privileges.
RUN chown -R node:node /app
USER node

CMD ["node", "server/index.js"]
