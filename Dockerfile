# Use Node.js for building the frontend
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Final production image
FROM node:20-slim
WORKDIR /app

# Install system dependencies for yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp and youtube-transcript-api fallback
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    pip3 install youtube-transcript-api --break-system-packages

# Copy build artifacts and server files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Create temp directory for board storage
RUN mkdir -p .tmp

EXPOSE 3000
CMD ["node", "server.js"]
