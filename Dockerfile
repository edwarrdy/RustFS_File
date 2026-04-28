# 使用轻量的 alpine 镜像作为基础
FROM node:20-alpine AS builder

# 安装编译 better-sqlite3 所需的工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 先复制依赖定义，利用 Docker 缓存
COPY package*.json ./
RUN npm install

# 复制源代码
COPY . .

# 最终运行阶段
FROM node:20-alpine

WORKDIR /app

# 只需要从 builder 阶段复制构建好的 node_modules 和源代码
COPY --from=builder /app /app

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
