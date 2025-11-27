FROM node:20-alpine

WORKDIR /app

# 先拷贝依赖清单，再安装依赖（走缓存）
COPY package*.json ./
RUN npm ci --omit=dev

# 再拷贝其余代码
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
