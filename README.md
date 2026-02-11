
---

# 🚀 RustFS 智能云盘系统 (Node.js 版)

这是一个专为局域网环境设计的、基于 S3 协议的高性能文件管理系统。它在 RustFS（或 MinIO）的基础上，通过 SQLite 实现了**无限层级的虚拟目录结构**。

## ✨ 核心特性

* **📂 虚拟层级目录**：采用 `Parent-ID` 树形结构，支持文件夹无限嵌套，前端操作与传统网盘无异。
* **🔗 UUID 路径隔离**：文件物理路径由 UUID 组成（如 `folder-uuid/file-uuid.ext`），彻底消除重名冲突，重命名文件夹仅需毫秒级（仅修改数据库元数据）。
* **⚡ 极速双模式传输**：
* **Mode A (中转)**：流经后端，适合小文件或需要经过 Node.js 逻辑处理的场景。
* **Mode B (直传)**：后端返回预签名 URL，前端直接对接 RustFS，**零服务器带宽占用**，轻松支持 GB 级大文件。


* **🛡️ 级联递归删除**：删除父文件夹时，自动递归清理所有子文件夹及 S3 中的物理文件。
* **🧭 面包屑导航**：内置回溯算法，快速生成目录路径链条。

---

## 🛠️ 技术架构

* **Runtime**: Node.js 20+
* **Database**: SQLite (via `better-sqlite3`) - 开启 WAL 模式保证高并发稳定性。
* **Storage**: AWS SDK v3 (S3 兼容协议)。

---

## 🚀 部署指南

### 1. 环境变量配置 (`.env`)

```env
PORT=3000
RUSTFS_ENDPOINT="http://192.168.1.100:9000"
RUSTFS_REGION="us-east-1"
RUSTFS_ACCESS_KEY="admin"
RUSTFS_SECRET_KEY="password"
RUSTFS_BUCKET_NAME="my-storage"

```

### 2. 数据库说明

项目启动后会自动在根目录生成 `file-server.db`。若表结构发生重大变化，建议备份后删除该文件，重启服务即可自动重构。

---

## 📚 API 接口说明

所有接口前缀建议使用：`http://<IP>:3000/api/v1/files`

### 1. 目录与导航

| 接口 | 方法 | 说明 | 参数 |
| --- | --- | --- | --- |
| `/content` | GET | **核心接口**：获取当前目录内容 | `folderUuid`: 目标 ID (不传则为根) |
| `/folders` | POST | 创建新文件夹 | `{ "name": "...", "parentId": "..." }` |
| `/folders/:uuid` | DELETE | **级联删除**文件夹及其内容 | 无 |
| `/breadcrumbs` | GET | 获取当前位置的面包屑路径 | `folderUuid` |

### 2. 文件上传

| 接口 | 方法 | 模式 | 流程 |
| --- | --- | --- | --- |
| `/upload` | POST | Mode A | 直接通过 `multipart/form-data` 上传，字段名 `file` |
| `/presigned/upload-url` | POST | Mode B (1) | 获取上传签名 URL，需带上 `folderUuid` |
| `/presigned/callback` | POST | Mode B (2) | 上传 RustFS 成功后回传元数据，持久化到数据库 |

### 3. 下载与删除

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/download/:id` | GET | 服务器中转下载，支持原始文件名重命名 |
| `/presigned/download/:id` | GET | 获取 1 小时有效期的直连下载 URL |
| `/:id` | DELETE | 删除单个文件 |

---

## 📂 项目目录结构

```text
RustFS_File/
├── src/
│   ├── config/       # 数据库与 S3 客户端连接
│   ├── controllers/  # 业务逻辑调度与 API 返回封装
│   ├── services/     # 核心业务层 (递归删除、SQL 操作)
│   ├── routes/       # 路由定义 (API v1)
│   └── middlewares/  # Multer 上传限制、鉴权
├── server.js         # 程序入口
├── index.html        # 全功能前端测试台
└── .env              # 敏感配置

```

---

## ⚠️ 局域网注意事项 (Best Practices)

1. **CORS 权限**：若 Mode B 上传失败，请确保 RustFS/MinIO 后台已配置 CORS 规则，允许 `PUT` 方法。
2. **大文件删除**：递归删除大文件夹时，由于涉及大量 S3 网络请求，接口响应可能稍慢，前端应增加 Loading 状态。
3. **API 地址**：在局域网内供他人调用时，请将 `localhost` 改为服务器的局域网静态 IP。

---

**License**: MIT

**Author**: Edward

---
