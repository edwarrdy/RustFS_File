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
require("dotenv").config();

const s3Client = new S3Client({
  endpoint: process.env.RUSTFS_ENDPOINT,
  region: process.env.RUSTFS_REGION,
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY,
    secretAccessKey: process.env.RUSTFS_SECRET_KEY,
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
