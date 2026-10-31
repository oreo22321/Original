FROM node:22-alpine AS luau-builder
# luau バイナリをソースからビルド（alpine musl対応の公式手順）
RUN apk add --no-cache cmake make g++ git && \
    git clone --depth=1 --branch v0.661 https://github.com/luau-lang/luau.git /luau && \
    cd /luau && \
    cmake -S . -B build \
      -DCMAKE_BUILD_TYPE=Release \
      -DLUAU_BUILD_CLI=ON \
      -DLUAU_BUILD_TESTS=OFF \
      -DLUAU_BUILD_WEB=OFF && \
    cmake --build build --target Luau.Repl.CLI -j$(nproc) && \
    strip build/luau

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
# luau バイナリをコピー
COPY --from=luau-builder /luau/build/luau /usr/local/bin/luau
WORKDIR /app
COPY app.zip .
RUN unzip -q app.zip && rm app.zip && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
