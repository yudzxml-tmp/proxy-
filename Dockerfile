# Gunakan base image Playwright versi terbaru
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

WORKDIR /app

# Salin package.json (tanpa lock)
COPY package*.json ./

# Install dependencies (tanpa dev)
RUN npm install --omit=dev

# Salin semua file project
COPY . .

# Pastikan Chromium terinstall
RUN npx playwright install --with-deps chromium

# Set environment
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]