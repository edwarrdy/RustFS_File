# 第一阶段：构建环境 (使用 Alpine)
FROM node:20-alpine AS builder

# 安装编译 better-sqlite3 所需的轻量级工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 复制依赖定义
COPY package*.json ./
RUN npm install

# 复制源代码
COPY . .

# 第二阶段：运行环境 (极简 Alpine)
FROM node:20-alpine

WORKDIR /app

# 复制构建产物
COPY --from=builder /app /app

# 暴露端口
EXPOSE 3300

# 启动命令
CMD ["node", "server.js"]
