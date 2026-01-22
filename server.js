/*
 * @Author: edward jifengming92@163.com
 * @Date: 2026-01-21 15:17:30
 * @LastEditors: edward jifengming92@163.com
 * @LastEditTime: 2026-01-21 15:48:09
 * @FilePath: \RustFS_File\server.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const express = require("express");
const cors = require("cors");
const path = require("path");
// 尽早加载环境变量，确保数据库和 AWS 配置能读到
require("dotenv").config();

// 引入路由
const fileRoutes = require("./src/routes/fileRoutes");

// 引入数据库配置 (虽然 route 会间接引用，显式引用可以确保启动时就初始化表结构)
require("./src/config/db");

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. 全局中间件 ---

// 允许跨域 (CORS)，这样你的前端 (Vue/React) 才能访问
app.use(cors());

// 解析 JSON 请求体 (关键：处理预签名回调时的 JSON 数据)
app.use(express.json());

// 解析 URL-encoded 请求体 (可选，用于处理普通表单)
app.use(express.urlencoded({ extended: true }));

// --- 2. 注册路由 ---

// 将文件相关的路由挂载到 /files 路径下
// 例如:
//   上传接口 -> POST /files/upload
//   获取上传URL -> POST /files/presigned/upload-url
app.use("/files", fileRoutes);

// 健康检查接口 (用于测试服务器是否活着)
app.get("/", (req, res) => {
  res.send({
    status: "ok",
    message: "RustFS Node Server is running",
    backend: "better-sqlite3 + aws-sdk-v3",
  });
});

// --- 3. 全局错误处理 ---

// 404 处理 (未匹配到任何路由)
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint Not Found" });
});

// 500 处理 (代码抛出异常时的兜底)
app.use((err, req, res, next) => {
  console.error("[Server Error]", err.stack);
  // 不向客户端暴露具体的错误堆栈，只返回通用错误
  res.status(500).json({ error: "Internal Server Error" });
});

// --- 4. 启动服务 ---
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📂 Database: SQLite (via better-sqlite3)`);
  console.log(`☁️  Storage:  RustFS (S3 Compatible)`);
  console.log(`=========================================`);
});
