
---

# 🚀 RustFS 文件服务器 API 接口文档 (v1.0)

本服务提供基于 S3 协议的文件存储管理，支持多级目录嵌套、服务器中转上传及前端预签名直传。

**基础 URL:** `http://<服务器IP>:3000/api/v1/files`

**数据格式:** `application/json`

---

## 1. 文件夹管理 (Folders)

### 1.1 获取目录内容

获取指定文件夹下的所有子文件夹和文件。

* **URL:** `GET /content`
* **参数:** * `folderUuid` (Query, String): 目标文件夹 UUID。不传或传 `root` 获取根目录。
* **返回:**
```json
{
  "folders": [{ "uuid": "...", "displayName": "工作", "parentId": null }],
  "files": [{ "id": 1, "originalName": "test.pdf", "size": 1024 }]
}

```



### 1.2 创建文件夹

* **URL:** `POST /folders`
* **Body:**
```json
{
  "name": "我的文件夹",
  "parentId": "uuid-xxx" // 可选，不传则创建在根目录
}

```



### 1.3 递归删除文件夹

删除文件夹及其内部所有子文件夹和文件（物理删除 S3 文件）。

* **URL:** `DELETE /folders/:uuid`

### 1.4 获取面包屑导航

获取从根目录到当前目录的完整路径链条。

* **URL:** `GET /breadcrumbs`
* **参数:** `folderUuid` (Query)

---

## 2. 文件上传 (Upload)

### 2.1 模式 A：服务器中转上传

文件流经 Node.js 后端，适合小文件。

* **URL:** `POST /upload`
* **Content-Type:** `multipart/form-data`
* **Body:** * `file`: 文件二进制
* `folderUuid`: 目标文件夹 UUID (可选)



### 2.2 模式 B：前端直传 (推荐)

1. **获取上传签名**: `POST /presigned/upload-url`
* **Body**: `{ "filename": "a.zip", "mimetype": "application/zip", "folderUuid": "..." }`
* **返回**: `{ "uploadUrl": "...", "key": "uuid-name" }`


2. **前端直传**: 使用 `PUT` 请求将文件发送到 `uploadUrl`。
3. **完成回调**: `POST /presigned/callback`
* **Body**: 包含 `key`, `originalName`, `size`, `mimetype`, `folderUuid`。



---

## 3. 文件下载与管理 (Download & Manage)

### 3.1 模式 A：普通下载 (流转)

* **URL:** `GET /download/:id`
* **说明:** 直接触发浏览器下载。

### 3.2 模式 B：加速下载 (预签名直链)

* **URL:** `GET /presigned/download/:id`
* **返回:** `{ "url": "https://rustfs...", "filename": "..." }`
* **说明:** 前端拿到 URL 后通过 `window.open` 或 `<a>` 标签下载。

### 3.3 删除单个文件

* **URL:** `DELETE /:id`

---

## 4. 状态码参考

| 状态码 | 含义 | 说明 |
| --- | --- | --- |
| `200` | OK | 请求成功 |
| `201` | Created | 创建成功 (上传/建目录) |
| `400` | Bad Request | 参数缺失或格式错误 |
| `404` | Not Found | 文件或文件夹不存在 |
| `500` | Error | 服务器内部错误 (如 S3 连接超时) |

---

### 调用建议 (Tips)

1. **UUID 机制**: 文件夹和文件的物理存储均使用 UUID，不用担心局域网内文件名冲突。
2. **大文件建议**: 超过 50MB 的文件请务必使用 **模式 B**，以节省后端网关带宽。
3. **空目录查询**: 当 `folderUuid` 为空时，系统默认指向逻辑根目录。

