FROM node:18-slim

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ && \
    npm install --production

COPY . .

ENV PORT=80
EXPOSE 80

CMD ["node", "server.js"]
