/*
 * @Author: edward jifengming92@163.com
 * @Date: 2026-01-21 15:16:56
 * @LastEditors: edward jifengming92@163.com
 * @LastEditTime: 2026-02-10 15:36:15
 * @FilePath: \RustFS_File\src\routes\fileRoutes.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const express = require("express");
const router = express.Router();
const fileController = require("../controllers/fileController");
const uploadMiddleware = require("../middlewares/upload"); // 保持原有的 multer.memoryStorage

// 文件夹操作
router.post("/folders", fileController.createFolder); // 创建
router.get("/content", fileController.getContent); // 获取目录内容
router.delete("/folders/:uuid", fileController.removeFolder); // 递归删除

// --- 模式 A: 简单服务器中转 ---
router.post("/upload", uploadMiddleware.single("file"), fileController.upload);
router.get("/download/:id", fileController.downloadStream);

// --- 模式 B: 高效预签名 (前端直传) ---
// 1. 获取上传 URL
router.post("/presigned/upload-url", fileController.getUploadUrl);
// 2. 上传完成回调
router.post("/presigned/callback", fileController.uploadCallback);

// 模式 B 路由
router.get("/presigned/download/:id", fileController.getDownloadUrl);

// --- 通用管理 ---
router.get("/", fileController.list);
router.delete("/:id", fileController.remove);

router.get("/breadcrumbs", fileController.getBreadcrumbs);

module.exports = router;
