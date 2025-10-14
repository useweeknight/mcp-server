# 体积小、冷启动快
FROM node:18-alpine

# 防止 npm 警告 & 更快、更可重复的安装
ENV NODE_ENV=production

WORKDIR /app

# 没有依赖也无所谓，保持通用写法
COPY package*.json ./ || true
RUN if [ -f package.json ]; then npm ci --omit=dev; fi

# 拷贝源代码
COPY . .

# Cloud Run 约定端口
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
