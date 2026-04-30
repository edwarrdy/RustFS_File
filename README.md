# RustFS 智能云盘 (Node.js 版)

这是一个基于 Node.js 构建的高性能文件管理后端，专为兼容 S3 协议的存储服务（如 RustFS, MinIO）设计。

## 🌟 新特性：环境自适应配置

项目现在支持 **开发环境** 与 **生产环境** 的自动适配，解决了 Docker 部署时的地址硬编码问题。

- **开发环境**：默认连接 `localhost:19000`。
- **生产环境 (Docker)**：自动使用容器内网 `http://rustfs-storage:9000` 进行高速通信，同时支持通过环境变量动态配置公网访问地址。

---

## 🚀 核心功能

- **⚡ 极速直传 (Mode B)**：利用 S3 预签名 URL 授权，客户端直接将文件推送到存储服务器。
- **📁 文件夹深度管理**：支持递归上传、实时 ZIP 流式压缩下载、级联删除。
- **🧭 导航与体验**：面包屑导航、上传进度条、实时日志监控。
- **🛠 性能优化**：数据库索引优化、S3 批量删除、事务一致性。

---

## 📦 部署指南

### 1. 开发环境启动 (Local Development)

1.  复制环境文件：`cp .env.example .env`
2.  安装依赖：`npm install`
3.  启动：`npm run dev`
    - API 地址: `http://localhost:3300`
    - 默认 RustFS 端口: `19000`

### 2. 生产环境部署 (Docker Compose)

在生产服务器上，推荐使用 `docker-compose.yml` 进行一键部署：

1.  **准备环境文件**：
    创建 `.env` 文件并设置你的公网 IP：
    ```ini
    NODE_ENV=production
    RUSTFS_PUBLIC_ENDPOINT="http://你的服务器IP:9000"
    RUSTFS_ACCESS_KEY="rustfsadmin"
    RUSTFS_SECRET_KEY="rustfsadmin"
    ```
2.  **启动服务**：
    ```bash
    docker-compose up -d
    ```
    - API 将通过容器内网 `rustfs-storage:9000` 访问存储，安全且高效。
    - 预签名链接将自动使用你配置的 `RUSTFS_PUBLIC_ENDPOINT`。

---

## ⚙️ 环境变量说明

| 变量名 | 描述 | 默认 (开发/生产) |
| :--- | :--- | :--- |
| `NODE_ENV` | 环境标识 | `development` / `production` |
| `RUSTFS_ENDPOINT` | API 访问存储的内部地址 | `localhost:19000` / `rustfs-storage:9000` |
| `RUSTFS_PUBLIC_ENDPOINT` | 浏览器访问存储的地址 | `localhost:19000` / (需手动配置) |
| `DATABASE_PATH` | SQLite 数据库存放路径 | `./data/file-server.db` |

---

## 🤖 自动化打包 (CI/CD)

项目预置了 `.github/workflows/docker-publish.yml`。
- **构建环境**：Ubuntu (搬运工)
- **运行环境**：Node 20 Alpine (极简镜像，~150MB)
- **安全**：`.dockerignore` 已配置忽略所有 `.env` 文件，防止开发配置泄漏。

## 📄 接口文档
详细 API 说明请参考 [API_README.md](./API_README.md)。
