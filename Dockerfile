# Sirve tal cual para Railway, Fly.io, Render o cualquier VPS con Docker.
#
# Dos etapas porque better-sqlite3 es un módulo nativo: si no hay binario precompilado
# para la plataforma, se compila, y eso necesita python/make/g++. Nada de eso tiene por
# qué viajar en la imagen final.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# La base y los backups viven en un volumen montado acá. Si el hosting no monta nada,
# el contenedor igual arranca: escribe adentro y se pierde al redeplegar — que es
# exactamente el error que hay que evitar, por eso está documentado en el README.
ENV DB_PATH=/data/fabrica.db
ENV BACKUP_DIR=/data/backups
VOLUME /data

# No corre como root. Es gratis y evita una clase entera de problemas.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
CMD ["npm", "start"]
