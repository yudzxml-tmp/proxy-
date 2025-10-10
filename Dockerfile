# Gunakan image Playwright resmi yang sudah lengkap dengan browser
FROM mcr.microsoft.com/playwright:latest

# Set working directory
WORKDIR /app

# Copy package.json & package-lock.json
COPY package*.json ./

# Install dependencies production tanpa audit, optimasi cache
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --prefer-offline --production; \
    else \
      npm install --no-audit --prefer-offline --production; \
    fi

# Copy seluruh source code
COPY . .

# Pastikan user pwuser punya akses ke folder /app
RUN if id -u pwuser >/dev/null 2>&1; then \
      chown -R pwuser:pwuser /app; \
      USER pwuser; \
    else \
      echo "pwuser not found, continuing as current user"; \
    fi

# Expose port API
EXPOSE 8080

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Healthcheck sederhana untuk memastikan Chromium bisa dijalankan via @divriots/playwright-extra
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "import('@divriots/playwright-extra').then(({chromium})=>chromium.launch().then(b=>b.close()).then(()=>process.exit(0)).catch(()=>process.exit(1))).catch(()=>process.exit(1))"

# Start server
CMD ["node", "server.js"]