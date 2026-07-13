FROM node:18-alpine

# 国内源加速
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.tencent.com/g' /etc/apk/repositories

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ && \
    npm install --production

COPY . .

# CloudBase 云托管会自动注入 PORT 环境变量
EXPOSE 80

CMD ["node", "server.js"]
