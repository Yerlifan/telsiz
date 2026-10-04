# Telsiz sunucusunun kapsayıcı imajı
# Container image for the Telsiz server
#
# Derleme: docker build -t telsiz .
# Build:   docker build -t telsiz .
# Çalıştırma: docker run -d --name telsiz -p 127.0.0.1:3000:3000 -v telsiz-veri:/data telsiz
# Run:        docker run -d --name telsiz -p 127.0.0.1:3000:3000 -v telsiz-veri:/data telsiz
# Kurulum kodu: docker logs telsiz
# Setup code:   docker logs telsiz

# Resmi Node.js 22 Alpine imajı
# Official Node.js 22 Alpine image
FROM node:22-alpine

# Üretim kipi, kalıcı veri klasörü ve dinlenen adres. Kapsayıcı içinde 0.0.0.0 gerekir.
# Production mode, persistent data directory and listen address. 0.0.0.0 is required inside a container.
ENV NODE_ENV=production \
    VERI_KLASORU=/data \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Yalnızca çalışma zamanı dosyaları kopyalanır. Çalışma zamanı bağımlılığı olmadığı için npm ci gerekmez.
# Only runtime files are copied. No npm ci is needed because there are no runtime dependencies.
# Dosyalar root kullanıcısına aittir, uygulama kendi kodunu değiştiremez.
# Files are owned by root, so the application cannot modify its own code.
COPY package.json LICENSE server.js ./
COPY src ./src
COPY public ./public

# Veri klasörü yalnızca root olmayan node kullanıcısına açıktır
# The data directory is accessible only to the non-root node user
RUN mkdir -p /data && chown node:node /data && chmod 700 /data

USER node

VOLUME /data
EXPOSE 3000

# Sağlık denetimi Node ile yapılır, imaja curl veya wget eklenmez
# The health check uses Node, so no curl or wget is added to the image
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('node:http').get({ host: '127.0.0.1', port: process.env.PORT || 3000, path: '/api/info', timeout: 4000 }, (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('timeout', function () { this.destroy(new Error('timeout')) }).on('error', () => process.exit(1))"]

CMD ["node", "server.js"]
