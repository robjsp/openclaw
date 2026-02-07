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
WORKDIR /workspace

# Cache busting argument for forcing fresh git clone
ARG CACHEBUST=1

# Clone openclaw from GitHub
RUN git clone --depth 1 https://github.com/robjsp/openclaw.git /workspace/openclaw

# Install dependencies and build
WORKDIR /workspace/openclaw
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm build || true

# Build Firebase plugin extension
WORKDIR /workspace/openclaw/extensions/firebase
RUN pnpm build:local || echo "Firebase plugin build failed, but continuing..."
WORKDIR /workspace/openclaw

# Install openclaw globally
# RUN npm install -g openclaw@latest

# Set up openclaw config directory
RUN mkdir -p /root/.openclaw

# Back to workspace root
WORKDIR /workspace

# Start gateway on container boot (script from cloned repo)
RUN chmod +x /workspace/openclaw/openclaw-image/start-gateway.sh
CMD ["/workspace/openclaw/openclaw-image/start-gateway.sh"]
