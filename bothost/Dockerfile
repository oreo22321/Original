# BotHost を 1 つのコンテナで動かす (process モード。Python と Node.js の bot が動きます)
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV PORT=3000 BOTHOST_DATA=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
