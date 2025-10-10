# Gunakan base image Node.js dengan Playwright dependencies
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

# Set working directory
WORKDIR /app

# Salin package.json dan install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Salin seluruh file project ke dalam container
COPY . .

# Variabel environment agar Playwright tahu path Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

# Port default server Express kamu
EXPOSE 8080

# Jalankan server
CMD ["node", "server.js"]