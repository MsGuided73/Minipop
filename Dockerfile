# Use Node.js for building the frontend
FROM node:20-slim AS builder
WORKDIR /app

# Vite inlines every VITE_* value into the bundle at BUILD time, so these have
# to exist while `npm run build` runs. Runtime environment variables set on the
# host are injected into the running container and are NOT present during
# `docker build` — and .env is gitignored, so it is not in the build context
# either. They must therefore arrive as build arguments:
#
#   docker build --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... .
#
# On a PaaS, mark both as build-time variables rather than runtime ones.
#
# Only public VITE_* values belong here. Build arguments are recorded in the
# image history, so never pass a real secret (service-role key, APIFY token)
# this way. The Supabase anon key is safe because RLS is enabled on every
# table — see src/services/supabaseClient.js.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Fail loudly rather than shipping a bundle that cannot authenticate. Without
# this the build succeeds, the site loads, and every visitor gets the
# "auth is not configured" screen — which is how this shipped once already.
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" || { \
      echo "ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be passed as build args."; \
      echo "       Vite bakes them in at build time; setting them at runtime has no effect."; \
      exit 1; \
    }

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Prove the key actually landed in the bundle, so a silent miss cannot ship.
RUN grep -rqE "eyJ|sb_publishable_" dist/assets/*.js || { \
      echo "ERROR: no Supabase key found in the built bundle."; exit 1; }

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
