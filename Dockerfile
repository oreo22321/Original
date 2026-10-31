FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787

WORKDIR /app
COPY app.zip .
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && unzip -q app.zip && rm app.zip \
    && apt-get purge -y unzip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /app

# luau バイナリを同梱する場合（app.zip内の bin/luau を使用）
# zip内に bin/luau が含まれていれば自動で /usr/local/bin/luau にコピー
RUN if [ -f /app/bin/luau ]; then \
      cp /app/bin/luau /usr/local/bin/luau && \
      chmod +x /usr/local/bin/luau && \
      echo "luau installed: $(luau --version)"; \
    else \
      echo "WARNING: bin/luau not found. Code execution will use fallback mode."; \
    fi

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
