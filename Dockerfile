# Gunakan base image Playwright versi terbaru yang sudah include Chromium, Firefox, dan WebKit
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

# Set direktori kerja
WORKDIR /app

# Salin file package.json dan package-lock.json
COPY package*.json ./

# Install dependencies (tanpa devDependencies untuk image yang lebih ringan)
RUN npm ci --omit=dev

# Salin seluruh project ke dalam container
COPY . .

# Set environment variable untuk memastikan Playwright pakai browser bawaan
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PUPPETEER_EXECUTABLE_PATH=/ms-playwright/chromium-1194/chrome-linux/chrome
ENV NODE_ENV=production

# Pastikan Playwright sudah menginstall semua browser dependencies
RUN npx playwright install --with-deps chromium

# Expose port server Express kamu
EXPOSE 8080

# Jalankan server
CMD ["node", "server.js"]