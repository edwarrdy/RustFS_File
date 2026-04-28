/*
 * @Author: edward jifengming92@163.com
 * @Date: 2026-01-21 15:16:08
 * @LastEditors: edward jifengming92@163.com
 * @LastEditTime: 2026-01-21 15:24:57
 * @FilePath: \RustFS_File\src\config\s3.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const { S3Client } = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const s3Client = new S3Client({
  // 优先读环境变量，否则尝试连接 Compose 中的默认存储名
  endpoint: process.env.RUSTFS_ENDPOINT || "http://rustfs-storage:9000",
  region: process.env.RUSTFS_REGION || "cn-north-1",
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY || "admin",
    secretAccessKey: process.env.RUSTFS_SECRET_KEY || "password123",
  },
  // 核心配置：必须启用 Path-style 以兼容 RustFS
  forcePathStyle: true,
  // 配置超时，防止网络卡死
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 10000,
    socketTimeout: 180000, // 上传大文件时适当调大
  }),
  maxAttempts: 3,
});

module.exports = {
  s3Client,
  BUCKET_NAME: process.env.RUSTFS_BUCKET_NAME,
};
