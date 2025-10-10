# Gunakan Playwright base image (sudah ada browser + dependencies)
FROM mcr.microsoft.com/playwright:latest

# Set working directory
WORKDIR /app

# Copy package.json & package-lock.json dulu (memanfaatkan cache layer)
COPY package*.json ./

# Install dependencies tanpa audit & lebih cepat
RUN npm ci --no-audit --prefer-offline

# Copy seluruh source code
COPY . .

# Pastikan package.json type module (untuk import/export)
# EXPOSE port aplikasi
EXPOSE 8080

# Healthcheck: pastikan Chromium bisa dijalankan
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "import('playwright').then(({chromium})=>chromium.launch().then(b=>b.close()).then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)}))"

# Environment variables default (opsional)
ENV NODE_ENV=production
ENV PORT=8080

# Start server
CMD ["node", "server.js"]