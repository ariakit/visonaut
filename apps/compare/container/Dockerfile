FROM docker.io/library/node@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6

WORKDIR /app/apps/compare/container
COPY apps/compare/container/package.json apps/compare/container/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund --os=linux --cpu=x64 --libc=glibc
COPY packages/compare/src /app/packages/compare/src
COPY apps/compare/container/server.mjs ./server.mjs

USER node
EXPOSE 8080
CMD ["node", "/app/apps/compare/container/server.mjs"]
