# Matching Engine Dockerfile
FROM oven/bun:1 AS base

WORKDIR /app

# Copy package files
COPY matching/package.json ./matching/

# Install dependencies
WORKDIR /app/matching
RUN bun install --frozen-lockfile || bun install

# Copy source code (matching + spot directories, maintaining relative paths)
WORKDIR /app
COPY matching/ ./matching/
COPY spot/ ./spot/

# Expose port
EXPOSE 8081

ENV PORT=8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q --spider http://localhost:8081/health || exit 1

# Run the application from matching directory
WORKDIR /app/matching
CMD ["bun", "run", "server.ts"]
