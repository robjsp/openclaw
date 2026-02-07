FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=22

# Install system dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    python3 \
    ripgrep \
    gnupg \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Create workspace directory
WORKDIR /workspace/openclaw

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions/firebase/package.json ./extensions/firebase/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY . .

# Build openclaw
RUN pnpm build || true

# Build Firebase plugin extension
WORKDIR /workspace/openclaw/extensions/firebase
RUN pnpm build:local || echo "Firebase plugin build failed, but continuing..."
WORKDIR /workspace/openclaw

# Set up openclaw config directory
RUN mkdir -p /root/.openclaw

# Copy entrypoint script
COPY openclaw-image/start-gateway.sh /usr/local/bin/start-gateway.sh
RUN chmod +x /usr/local/bin/start-gateway.sh

# Back to workspace root
WORKDIR /workspace

# Start gateway on container boot
CMD ["/usr/local/bin/start-gateway.sh"]
