FROM node:22-bookworm-slim

# Dependencias de sistema requeridas por el Chrome Headless Shell que usa
# Remotion para renderizar (lista oficial: https://www.remotion.dev/docs/docker)
RUN apt-get update && apt-get install -y \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libgbm-dev \
    libasound2 \
    libxrandr2 \
    libxkbcommon-dev \
    libxfixes3 \
    libxcomposite1 \
    libxdamage1 \
    libatk-bridge2.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY remotion.config.mjs ./
COPY server.mjs ./
COPY src ./src

# Descarga el Chrome Headless Shell en build time (no en cada arranque)
RUN npx remotion browser ensure

ENV PORT=4000
ENV OUTPUT_DIR=/app/output
RUN mkdir -p /app/output

EXPOSE 4000

CMD ["node", "server.mjs"]
