FROM oven/bun:1-alpine
WORKDIR /app
COPY server.ts ./
COPY site/ ./site/
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/health || exit 1
CMD ["bun", "server.ts"]
