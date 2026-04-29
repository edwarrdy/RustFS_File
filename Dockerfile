# 第一阶段：构建环境 (使用 Alpine)
FROM node:20-alpine AS builder

# 安装编译 better-sqlite3 所需的轻量级工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 复制依赖定义
COPY package*.json ./

# 安装所有依赖（包括 devDependencies，因为构建可能需要它们）
RUN npm install

# 复制源代码
COPY . .

# 第二阶段：运行环境 (极简 Alpine)
FROM node:20-alpine

# 安装运行时可能需要的库 (better-sqlite3 需要)
RUN apk add --no-cache libstdc++

WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production

# 仅从构建阶段复制必要的文件
# 注意：为了让 better-sqlite3 正常工作，我们需要已编译好的 node_modules
COPY --from=builder /app /app

# 暴露端口
EXPOSE 3300

# 启动命令
CMD ["node", "server.js"]
