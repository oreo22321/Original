# node:22 (Debian bookworm) ベース — glibc 版 luau プリビルドバイナリがそのまま動く
FROM node:22-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787

# luau 公式プリビルドバイナリ (x86_64-linux / glibc) をインストール
# https://github.com/luau-lang/luau/releases
ARG LUAU_VERSION=0.661
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget unzip ca-certificates \
    && wget -q "https://github.com/luau-lang/luau/releases/download/${LUAU_VERSION}/luau-linux.zip" \
    && unzip -q luau-linux.zip \
    && mv luau /usr/local/bin/luau \
    && chmod +x /usr/local/bin/luau \
    && rm -f luau-linux.zip luau-analyze \
    && luau --version \
    && apt-get purge -y wget unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY app.zip .
RUN unzip -q app.zip && rm app.zip && chown -R node:node /app

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
