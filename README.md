# RustFS 智能云盘 (Node.js 版)

这是一个基于 Node.js 构建的高性能文件管理后端，专为兼容 S3 协议的存储服务（如 RustFS, MinIO）设计。它结合了 SQLite 的轻量级元数据管理与 S3 预签名技术，实现了大文件秒级直传和高效的文件夹层级管理。

## 🚀 核心功能

- **⚡ 极速直传 (Mode B)**：利用 S3 预签名 URL 授权，客户端直接将文件推送到存储服务器。
- **📁 文件夹深度管理**：支持递归上传、实时 ZIP 流式压缩下载、级联删除。
- **🧭 导航与体验**：面包屑导航、上传进度条、实时日志监控。
- **🛠 性能优化**：数据库索引优化、S3 批量删除、事务一致性。

## 🛠 技术栈

- **后端**: Node.js + Express 5.x (运行于 Alpine Linux)
- **数据库**: SQLite (via `better-sqlite3`)
- **存储服务**: RustFS (S3 兼容)
- **部署**: Docker + Docker Compose + GitHub Actions

## 📦 部署指南

### 1. 快速开始 (全栈部署)
项目已集成 RustFS 存储服务，API 服务基于 **Alpine 3.x**，镜像体积小且运行高效。

```bash
# 构建并一键启动 API + RustFS 存储
docker-compose up -d --build
```
- **API 地址**: `http://localhost:3000`
- **存储服务**: `http://localhost:9000`

### 2. 环境变量配置 (.env)
```env
RUSTFS_ENDPOINT=你的S3终端地址
RUSTFS_REGION=cn-north-1
RUSTFS_ACCESS_KEY=admin
RUSTFS_SECRET_KEY=password123
RUSTFS_BUCKET_NAME=my-bucket
```

## 🤖 自动化打包 (CI/CD)
项目预置了 `.github/workflows/docker-publish.yml`。GitHub Actions 采用 **Ubuntu** 环境作为搬运工，最终产出并发布基于 **Alpine** 的极简镜像（~150MB），兼顾了构建速度和部署体积。
