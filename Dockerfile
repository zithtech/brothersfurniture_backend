FROM node:20-bookworm-slim

# Install Chromium and required dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    unzip \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    ca-certificates \
    libnss3 \
    libxss1 \
    libasound2 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Check Chromium installation
RUN which chromium && chromium --version

WORKDIR /app

# Prevent Puppeteer from downloading Chrome
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

ENV NODE_ENV=production
ENV PORT=5000

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 5000

CMD ["npm", "start"]
