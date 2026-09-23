# One image: private API on 127.0.0.1:3000, Caddy x402 gateway on :8080.
# Build: docker build -t pq-attest .

FROM caddy:builder AS caddy

RUN xcaddy build \
    --output /usr/bin/caddy \
    --with github.com/algorandecosystem/caddy-x402avm@v0.1.0

FROM node:22-bookworm-slim

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV CADDY_SITE_ADDRESS=:8080

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
