# Gunakan base image Node.js ringan
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install dependensi sistem yang dibutuhkan oleh Chromium
RUN apt-get update && apt-get install -y \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libxshmfence1 \
  xdg-utils \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Salin package.json dan install dependensi Node.js
COPY package*.json ./
RUN npm install --omit=dev

# Salin semua file ke container
COPY . .

# Set environment variable agar Puppeteer pakai Chromium bawaan sistem
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Jalankan server Express kamu
EXPOSE 3000
CMD ["node", "server.js"]