# LiveGenie: the RHCC AVL knowledge base. Part of the Live series.
FROM node:22-alpine

ENV NODE_ENV=production \
    LIVEGENIE_DATA=/data \
    PORT=8080

# tzdata so the nightly backup runs at 02:30 local time (set TZ)
RUN apk add --no-cache tzdata

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# the database, pictures and backups live in /data (a volume, so they survive updates)
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
