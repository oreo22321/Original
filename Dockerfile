FROM node:22-alpine
WORKDIR /app
COPY app.zip .
RUN unzip -q app.zip && rm app.zip
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node","server.js"]
