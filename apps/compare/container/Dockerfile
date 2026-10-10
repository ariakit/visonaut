FROM docker.io/library/node@sha256:edf8c5ace79040421c2f00a4af06deeb7a1e2c5ffe33b6af7ca31964a092ca8b

WORKDIR /app/apps/compare/container
COPY apps/compare/container/package.json apps/compare/container/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund --os=linux --cpu=x64 --libc=glibc
COPY packages/compare/src /app/packages/compare/src
COPY apps/compare/container/server.mjs ./server.mjs

USER node
EXPOSE 8080
CMD ["node", "/app/apps/compare/container/server.mjs"]
