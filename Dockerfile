FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY app.zip .
RUN unzip -q app.zip && rm app.zip && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
