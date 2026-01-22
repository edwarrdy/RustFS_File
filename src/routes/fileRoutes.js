const express = require("express");
const router = express.Router();
const fileController = require("../controllers/fileController");
const uploadMiddleware = require("../middlewares/upload"); // 保持原有的 multer.memoryStorage

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

module.exports = router;
