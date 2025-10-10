# Gunakan image Node resmi yang stabil
FROM node:20-slim

# Set working directory
WORKDIR /app

# Salin package.json dan package-lock.json
COPY package*.json ./

# Install dependencies
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    libxshmfence1 \
    libxext6 \
    libxfixes3 \
    && rm -rf /var/lib/apt/lists/*

# Install Node dependencies
RUN npm install

# Salin semua file proyek
COPY . .

# Jalankan Puppeteer agar menggunakan Chromium bawaan (bukan unduh baru)
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Port default
EXPOSE 8080

# Command untuk menjalankan server
CMD ["node", "server.js"]