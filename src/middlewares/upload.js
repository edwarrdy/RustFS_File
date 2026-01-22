/*
 * @Author: edward jifengming92@163.com
 * @Date: 2026-01-21 15:17:12
 * @LastEditors: edward jifengming92@163.com
 * @LastEditTime: 2026-01-21 15:25:42
 * @FilePath: \RustFS_File\src\middlewares\upload.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const multer = require("multer");
const storage = multer.memoryStorage();
// 限制 50MB (仅针对服务器中转模式，预签名模式不受此限制)
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});
module.exports = upload;
