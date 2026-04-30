# 🚀 RustFS 文件服务器 API 接口文档 (v1.1)

本服务提供基于 S3 协议的文件存储管理，支持多级目录嵌套、服务器中转上传及前端预签名直传。

**基础 URL:** `http://<your-api-server>:3300/files`

---

## 1. 目录管理 (Folders)

### 1.1 获取目录内容
获取指定文件夹下的所有子文件夹和文件。
* **URL:** `GET /content`
* **Query 参数:** `folderUuid` (String, 可选)。不传或传 `root` 获取根目录。

### 1.2 创建文件夹
* **URL:** `POST /folders`
* **Body:** `{ "name": "我的文件夹", "parentId": "uuid-xxx" }`

### 1.3 递归删除文件夹
删除文件夹及其内容（物理删除 S3 文件）。
* **URL:** `DELETE /folders/:uuid`

### 1.4 获取面包屑导航
* **URL:** `GET /breadcrumbs`
* **Query 参数:** `folderUuid`

---

## 2. 文件上传 (Upload)

### 2.1 模式 A：服务器中转上传 (小文件)
文件流经 API 服务器。
* **URL:** `POST /upload`
* **Type:** `multipart/form-data`

### 2.2 模式 B：前端直传 (大文件/推荐)
1. **获取签名**: `POST /presigned/upload-url`
   * **Body**: `{ "filename": "a.zip", "mimetype": "application/zip", "folderUuid": "..." }`
   * **返回**: `{ "uploadUrl": "...", "key": "uuid-name" }`
2. **前端 PUT**: 将文件二进制流发送到 `uploadUrl`。
3. **完成回调**: `POST /presigned/callback`
   * **Body**: 包含文件元数据（key, originalName, size, mimetype）。

---

## 3. 下载与管理 (Download)

### 3.1 模式 A：普通下载 (流转)
* **URL:** `GET /download/:id`

### 3.2 模式 B：加速下载 (预签名直链)
* **URL:** `GET /presigned/download/:id`
* **返回:** `{ "url": "https://...", "filename": "..." }`

---

## 4. 环境说明

| 环境 | 典型 API URL | 存储服务端点 |
| :--- | :--- | :--- |
| **开发** | `localhost:3300` | `localhost:19000` |
| **生产** | `server-ip:3300` | `容器名:9000` (内部) |

---

### 调用建议
- **大文件限制**：模式 A 限制为 50MB。超过该大小请务必使用 **模式 B**。
- **并发处理**：后端已开启 SQLite WAL 模式，支持高并发读取。
