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
* 生成链接前通过内部存储端点校验对象是否存在；缺失或不可访问时返回 JSON 错误，页面显示错误而不会打开无效链接。`HeadObject` 对缺失桶可能仅返回通用 `404 NotFound`，此时需要结合存储端实际数据排查。

### 3.3 选中项目批量打包下载
* **URL:** `GET /batch-download`
* **Query 参数:** `fileIds` 和 `folderUuuids`，均为 JSON 数组，例如 `[1,2]` 和 `["folder-uuid"]`。构造 URL 时使用 `URLSearchParams` 编码；至少选择一个项目。
* **返回:** ZIP 文件流，包含选中的文件及文件夹中的全部嵌套文件。
* **状态码:** 参数无效返回 `400`；文件或文件夹不存在返回 `404`；存储桶不存在返回 `502`，错误详情为 JSON。若传输已经开始，后续读取失败会中断连接，客户端应视为下载失败。

### 3.4 文件夹打包下载
* **URL:** `GET /folders/download/:uuid`
* **返回:** 以文件夹名称命名的 ZIP 文件流；错误处理与批量下载一致。

页面在收到完整 ZIP 后才显示成功，失败时保留选择。支持 `showSaveFilePicker` 的浏览器会直接流式写入用户选择的文件；其他浏览器会先接收完整 Blob 再交由浏览器保存，大型 ZIP 建议使用支持流式保存的浏览器。

### 3.5 排查 `NoSuchBucket`
* 批量及文件夹打包请求应指向 **Node API** 的 `/files/batch-download` 或 `/files/folders/download/:uuid`，默认端口为 `3300`。不要将这些路径代理到 RustFS 的 S3 端口；检查反向代理的 `/files` 转发规则。
* 后端打包通过 `RUSTFS_ENDPOINT` 读取对象，并使用 SQLite 每条文件记录中的 `bucket`，而非当前 `RUSTFS_BUCKET_NAME`。修改环境变量不会迁移历史文件记录或对象。
* 单文件预签名下载使用 `RUSTFS_PUBLIC_ENDPOINT`。内外两个端点必须指向同一份实际存储，并且记录中的 bucket 和对象确实存在。应核对实际部署及存储数据后修正配置或迁移记录，避免用新建空桶掩盖历史文件缺失问题。

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
