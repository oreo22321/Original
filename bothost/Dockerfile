# BotHost を 1 つのコンテナで動かす (process モード。Python と Node.js の bot が動きます)
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# bot のライブラリは bot ごとのフォルダーに入れる (pip install --target) ので、システムの Python は汚しません
ENV PORT=3000 BOTHOST_DATA=/data PIP_BREAK_SYSTEM_PACKAGES=1 PIP_ROOT_USER_ACTION=ignore
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini: 止めるときのシグナルを node に渡し、bot のプロセスの後片付けもする
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
