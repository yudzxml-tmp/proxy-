FROM mcr.microsoft.com/playwright:latest

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --prefer-offline --production; \
    else \
      npm install --no-audit --prefer-offline --production; \
    fi

COPY . .

RUN if id -u pwuser >/dev/null 2>&1; then \
      chown -R pwuser:pwuser /app; \
      USER pwuser; \
    else \
      echo "pwuser not found, continuing as current user"; \
    fi

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "import('playwright').then(({chromium})=>chromium.launch().then(b=>b.close()).then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)})).catch(e=>{console.error(e); process.exit(1)})"

CMD ["node", "server.js"]