# Production Dockerfile for Dokploy with Puppeteer & Chromium Support
FROM node:20-bookworm-slim

# Install system dependencies, Chromium, and standard fonts for PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    ca-certificates \
    libnss3 \
    libxss1 \
    libasound2 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium package instead of downloading
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=5000

WORKDIR /app

# Copy package descriptors first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies (including tsx for running src/index.ts)
RUN npm install

# Copy application source
COPY . .

EXPOSE 5000

CMD ["npm", "start"]
