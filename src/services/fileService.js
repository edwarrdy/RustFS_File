const db = require("../config/db"); // 引入刚才改写的 db
const { s3Client, BUCKET_NAME } = require("../config/s3");
const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const path = require("path");

class FileService {
  constructor() {
    // 预编译常用的 SQL 语句 (提升性能)
    this.insertStmt = db.prepare(`
            INSERT INTO files (uuidName, originalName, mimetype, size, bucket)
            VALUES (@uuidName, @originalName, @mimetype, @size, @bucket)
        `);

    this.findByIdStmt = db.prepare("SELECT * FROM files WHERE id = ?");
    this.listAllStmt = db.prepare("SELECT * FROM files ORDER BY id DESC");
    this.deleteStmt = db.prepare("DELETE FROM files WHERE id = ?");

    this.initBucket();
  }

  async initBucket() {
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
    } catch (error) {
      // 忽略 bucket 已存在错误
    }
  }

  // --- 模式 A: 服务器中转 ---
  async uploadFileViaServer(fileObj) {
    const fileExtension = path.extname(fileObj.originalname);
    const uniqueKey = crypto.randomUUID() + fileExtension;

    // 1. 上传 S3 (依然是异步)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: uniqueKey,
        Body: fileObj.buffer,
        ContentType: fileObj.mimetype,
      }),
    );

    // 2. 写入 SQLite (better-sqlite3 是同步的，不需要 await)
    const info = this.insertStmt.run({
      uuidName: uniqueKey,
      originalName: fileObj.originalname,
      mimetype: fileObj.mimetype,
      size: fileObj.size,
      bucket: BUCKET_NAME,
    });

    // 返回插入后的完整对象
    return { id: info.lastInsertRowid, uuidName: uniqueKey, ...fileObj };
  }

  async getDownloadStream(id) {
    // 查库 (同步)
    const fileRecord = this.findByIdStmt.get(id);

    if (!fileRecord) throw new Error("FILE_NOT_FOUND_DB");

    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: fileRecord.bucket,
          Key: fileRecord.uuidName,
        }),
      );
      return { stream: response.Body, meta: fileRecord };
    } catch (error) {
      if (error.name === "NoSuchKey") throw new Error("FILE_NOT_FOUND_S3");
      throw error;
    }
  }

  // --- 模式 B: 预签名 ---
  async getPresignedUploadUrl(filename, mimetype) {
    const fileExtension = path.extname(filename);
    const uniqueKey = crypto.randomUUID() + fileExtension;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: uniqueKey,
      ContentType: mimetype,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    return { uploadUrl: url, key: uniqueKey, method: "PUT" };
  }

  // 回调保存
  async saveFileMetadata(metadata) {
    const info = this.insertStmt.run({
      uuidName: metadata.key,
      originalName: metadata.originalName,
      mimetype: metadata.mimetype,
      size: metadata.size,
      bucket: BUCKET_NAME,
    });
    return { id: info.lastInsertRowid, ...metadata };
  }

  async getPresignedDownloadUrl(id) {
    const fileRecord = this.findByIdStmt.get(id); // 同步查库
    if (!fileRecord) throw new Error("FILE_NOT_FOUND_DB");

    // 2. 处理中文文件名 (RFC 5987 标准)
    // 格式: attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.txt
    const encodedName = encodeURIComponent(fileRecord.originalName);
    const disposition = `attachment; filename*=UTF-8''${encodedName}`;

    const command = new GetObjectCommand({
      Bucket: fileRecord.bucket,
      Key: fileRecord.uuidName,
      // 核心修改：告诉 RustFS/S3，当有人访问这个链接时，
      // 响应头里必须带上这个 Content-Disposition，从而强制浏览器重命名
      ResponseContentDisposition: disposition,
      ResponseContentType: fileRecord.mimetype, // 顺便修正 Content-Type
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url, filename: fileRecord.originalName };
  }

  // --- 通用 ---
  async deleteFile(id) {
        // 1. 先查数据库
        const fileRecord = this.findByIdStmt.get(id);
        if (!fileRecord) throw new Error('FILE_NOT_FOUND_DB');

        // 2. 尝试从 RustFS 删除 (去除 try-catch，让错误抛出来)
        // 对于 S3 协议，删除一个不存在的文件也会返回成功 (204)，
        // 所以只要不报错，就说明“文件已确保消失”或“网络通畅”。
        console.log(`[Delete] 正在请求 RustFS 删除: ${fileRecord.uuidName}...`);
        
        try {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: fileRecord.bucket, 
                Key: fileRecord.uuidName
            }));
        } catch (error) {
            // 3. 关键点：如果这里报错了（比如超时），直接抛出异常
            // 这样代码就会中断，不会执行下面的 db.delete
            console.error(`[Delete Error] RustFS 删除失败，操作已回滚: ${error.message}`);
            throw new Error(`云端删除失败: ${error.message} (数据库未变动)`);
        }

        // 4. 只有云端确认删除了（或没报错），才删本地库
        this.deleteStmt.run(id);
        console.log(`[Delete] 数据库记录已清除 ID: ${id}`);
        
        return { id };
    }

  async getAllFiles() {
    return this.listAllStmt.all(); // 同步获取列表
  }
}

module.exports = new FileService();
