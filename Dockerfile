# Gunakan base image Node.js yang ringan
FROM node:22

# Set working directory di dalam container
WORKDIR /app

# Salin file package.json dan package-lock.json (kalau ada)
COPY package*.json ./

# Install dependencies secara efisien
RUN npm install --production

# Salin semua source code ke dalam container
COPY . .

# Set environment default (bisa di-override nanti)
ENV PORT=8080
ENV DEFAULT_PROXY=""
ENV NODE_ENV=production

# Expose port aplikasi
EXPOSE 8080

# Jalankan server
CMD ["node", "server.js"]