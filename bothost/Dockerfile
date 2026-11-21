# BotHost を 1 つのコンテナで動かします (process モード)。
# 動かせるもの: Python / Node.js (TypeScript も) / Java (.jar) / .NET (C# の .dll・.exe) /
#               Windows の .exe (Wine) / .bat・.cmd / シェル (.sh) / Ruby / PHP / Lua / Perl / Linux 用の実行ファイル
# ffmpeg (音楽 bot) と Bun は、使う bot があるときだけ自動で入れます (イメージを小さくするため)。
FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
# 言語と道具
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini git openssh-client tzdata unzip xz-utils procps \
      python3 python3-pip python-is-python3 libopus0 \
      openjdk-25-jre-headless \
      dotnet-runtime-10.0 aspnetcore-runtime-10.0 \
      ruby php-cli composer lua5.4 \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
# Windows の .exe 用 (Wine 64 ビット)。デバッグ情報を削って小さくします (約 650 MB → 約 150 MB)
RUN apt-get update \
 && apt-get install -y --no-install-recommends wine64 binutils-mingw-w64-x86-64 \
 && find /usr/lib/x86_64-linux-gnu/wine/x86_64-windows -type f \( -name '*.dll' -o -name '*.exe' -o -name '*.drv' -o -name '*.sys' -o -name '*.ocx' -o -name '*.cpl' -o -name '*.acm' -o -name '*.ax' -o -name '*.com' -o -name '*.tlb' \) \
      -exec x86_64-w64-mingw32-strip --strip-debug {} + 2>/dev/null; \
    apt-get purge -y binutils-mingw-w64-x86-64 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && for b in wine64 wineserver; do command -v $b >/dev/null || ln -s /usr/lib/wine/$b /usr/local/bin/$b; done \
 && ln -sf wine64 /usr/local/bin/wine && wine64 --version && wineserver --version
# Node.js 22 (公式のものをそのまま使う) + yarn / pnpm (corepack) + TypeScript を直接動かす tsx
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && corepack enable \
 && npm install -g --no-audit --no-fund --loglevel=error tsx@4 \
 && npm cache clean --force \
 && pip3 install --break-system-packages --no-cache-dir uv \
 && node --version && python --version && java -version 2>&1 | head -1 && dotnet --list-runtimes && ruby --version && php --version | head -1
WORKDIR /app
COPY . .
# bot のライブラリは bot ごとのフォルダーに入れる (pip install --target など) ので、システムは汚しません
ENV PORT=3000 BOTHOST_DATA=/data PIP_BREAK_SYSTEM_PACKAGES=1 PIP_ROOT_USER_ACTION=ignore \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN mkdir -p /data && chmod 755 /app/bin/* 2>/dev/null; true
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini: 止めるときのシグナルを node に渡し、bot のプロセスの後片付けもする
ENTRYPOINT ["/usr/bin/tini", "--"]
# サーバー自体のメモリに上限を付けて、bot にメモリを残す (無料プランは全部で 512 MB)
CMD ["node", "--max-old-space-size=192", "server.js"]
