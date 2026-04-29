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
const config = require("./index");

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  // 核心配置：必须启用 Path-style 以兼容 RustFS
  forcePathStyle: true,
  // 配置超时，防止网络卡死
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 10000,
    socketTimeout: 180000, // 上传大文件时适当调大
  }),
  maxAttempts: 3,
});

// 新增：专门用于生成预签名链接的客户端
// 在生产环境下，客户端（浏览器）无法解析 http://rustfs-storage 这种内部域名
// 因此需要一个外部可访问的地址（如 http://your-ip:9000）
const publicS3Client = new S3Client({
  endpoint: config.s3.publicEndpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: true,
});

module.exports = {
  s3Client,
  publicS3Client,
  BUCKET_NAME: config.s3.bucket,
};
