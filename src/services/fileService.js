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
    // --- 1. 文件夹相关 SQL ---

    // 创建文件夹：parentId 指向父级的 uuid
    this.createFolderStmt = db.prepare(`
        INSERT INTO folders (uuid, displayName, parentId)
        VALUES (?, ?, ?)
    `);
    // 查询当前层级的子文件夹 (分根目录和子目录两种情况)
    this.listRootFoldersStmt = db.prepare(
      "SELECT * FROM folders WHERE parentId IS NULL ORDER BY displayName ASC",
    );
    this.listSubFoldersStmt = db.prepare(
      "SELECT * FROM folders WHERE parentId = ? ORDER BY displayName ASC",
    );
    // 查找文件夹详情 (用于面包屑或校验)
    this.findFolderByUuidStmt = db.prepare(
      "SELECT * FROM folders WHERE uuid = ?",
    );

    this.deleteFolderStmt = db.prepare("DELETE FROM folders WHERE uuid = ?");

    // --- 2. 文件相关 SQL ---

    this.insertFileStmt = db.prepare(`
            INSERT INTO files (uuidName, originalName, mimetype, size, bucket, folderUuid)
            VALUES (@uuidName, @originalName, @mimetype, @size, @bucket, @folderUuid)
        `);

    this.insertStmt = db.prepare(`
            INSERT INTO files (uuidName, originalName, mimetype, size, bucket, folderUuid)
            VALUES (@uuidName, @originalName, @mimetype, @size, @bucket, @folderUuid)
        `);

    // 查询当前文件夹下的文件
    this.listFilesByFolderStmt = db.prepare(
      "SELECT * FROM files WHERE folderUuid = ? ORDER BY id DESC",
    );

    // 查询根目录下的文件 (如果你的逻辑是根目录文件 folderUuid 为 'root')
    this.listRootFilesStmt = db.prepare(
      "SELECT * FROM files WHERE folderUuid = 'root' ORDER BY id DESC",
    );

    this.listByFolderStmt = db.prepare(
      "SELECT * FROM files WHERE folderUuid = ? ORDER BY id DESC",
    );

    this.findFileByIdStmt = db.prepare("SELECT * FROM files WHERE id = ?");
    this.deleteFileStmt = db.prepare("DELETE FROM files WHERE id = ?");

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

  // --- 文件夹操作 ---
  async createFolder(displayName, parentId = null) {
    const uuid = crypto.randomUUID();
    // 处理前端可能传来的字符串 'null'
    const pId = parentId === "null" || !parentId ? null : parentId;
    this.createFolderStmt.run(uuid, displayName, pId);
    return { uuid, displayName, parentId: pId };
  }

  async getFolderContent(folderUuid = null) {
    const isRoot =
      !folderUuid || folderUuid === "null" || folderUuid === "root";
    const currentPId = isRoot ? null : folderUuid;

    const folders = isRoot
      ? this.listRootFoldersStmt.all()
      : this.listSubFoldersStmt.all(currentPId);
    const files = isRoot
      ? this.listRootFilesStmt.all()
      : this.listFilesByFolderStmt.all(currentPId);

    return { folders, files };
  }

  // --- 模式 A: 服务器中转 ---
  async uploadFileViaServer(fileObj, folderUuid = "root") {
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
    const info = this.insertFileStmt.run({
      uuidName: uniqueKey,
      originalName: fileObj.originalname,
      mimetype: fileObj.mimetype,
      size: fileObj.size,
      bucket: BUCKET_NAME,
      folderUuid: folderUuid || "root",
    });

    // 返回插入后的完整对象
    return { id: info.lastInsertRowid, uuidName: uniqueKey, ...fileObj };
  }

  // --- 模式 B: 预签名 ---
  async getPresignedUploadUrl(filename, mimetype, folderUuid = "root") {
    const fileExtension = path.extname(filename);
    const uniqueKey = crypto.randomUUID() + fileExtension;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: uniqueKey,
      ContentType: mimetype,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    return { uploadUrl: url, key: uniqueKey, folderUuid: folderUuid || "root" };
  }

  // 回调保存
  async saveFileMetadata(metadata) {
    const info = this.insertFileStmt.run({
      uuidName: metadata.key,
      originalName: metadata.originalName,
      mimetype: metadata.mimetype,
      size: metadata.size,
      bucket: BUCKET_NAME,
      folderUuid: metadata.folderUuid || "root",
    });
    return { id: info.lastInsertRowid, ...metadata };
  }

  // --- 下载与流处理 ---
  async getDownloadStream(id) {
    // 查库 (同步)
    const fileRecord = this.findFileByIdStmt.get(id);

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

  async getPresignedDownloadUrl(id) {
    const fileRecord = this.findFileByIdStmt.get(id); // 同步查库
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
    const fileRecord = this.findFileByIdStmt.get(id);
    if (!fileRecord) throw new Error("FILE_NOT_FOUND_DB");

    // 2. 尝试从 RustFS 删除 (去除 try-catch，让错误抛出来)
    // 对于 S3 协议，删除一个不存在的文件也会返回成功 (204)，
    // 所以只要不报错，就说明“文件已确保消失”或“网络通畅”。
    console.log(`[Delete] 正在请求 RustFS 删除: ${fileRecord.uuidName}...`);

    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: fileRecord.bucket,
          Key: fileRecord.uuidName,
        }),
      );
    } catch (error) {
      // 3. 关键点：如果这里报错了（比如超时），直接抛出异常
      // 这样代码就会中断，不会执行下面的 db.delete
      console.error(
        `[Delete Error] RustFS 删除失败，操作已回滚: ${error.message}`,
      );
      throw new Error(`云端删除失败: ${error.message} (数据库未变动)`);
    }

    // 4. 只有云端确认删除了（或没报错），才删本地库
    this.deleteFileStmt.run(id);
    console.log(`[Delete] 数据库记录已清除 ID: ${id}`);

    return { id };
  }

  // --- 递归删除文件夹及其所有子文件夹和文件 ---
  async deleteFolder(uuid) {
    // 1. 查找当前文件夹下的所有子文件夹
    const subFolders = this.listSubFoldersStmt.all(uuid);

    // 2. 递归调用自身，先处理子文件夹（深度优先遍历）
    for (const folder of subFolders) {
      await this.deleteFolder(folder.uuid);
    }

    // 3. 获取当前文件夹下的所有文件记录
    const files = this.listFilesByFolderStmt.all(uuid);

    // 4. 清理该文件夹下的所有文件 (S3 + 数据库)
    for (const file of files) {
      try {
        console.log(`[Recursive Delete] 正在清理 S3 文件: ${file.uuidName}`);
        
        // 从 S3 删除物理文件
        await s3Client.send(new DeleteObjectCommand({
          Bucket: file.bucket,
          Key: file.uuidName
        }));

        // 从数据库删除文件记录
        this.deleteFileStmt.run(file.id);
      } catch (error) {
        // 如果 S3 删除失败，抛出错误以中断流程，防止数据库记录被误删
        console.error(`[Delete Error] 无法删除 S3 文件 ${file.uuidName}:`, error.message);
        throw new Error(`文件夹清理中断：文件 ${file.originalName} 物理删除失败。`);
      }
    }

    // 5. 当所有子文件夹和文件都清理完毕后，删除当前文件夹记录
    this.deleteFolderStmt.run(uuid);
    
    console.log(`[Recursive Delete] 文件夹已彻底清除: ${uuid}`);
    return { uuid, success: true };
  }

  async getAllFiles() {
    return this.listAllStmt.all(); // 同步获取列表
  }

  // --- 获取面包屑导航 ---
  async getBreadcrumbs(folderUuid) {
    const breadcrumbs = [];
    let currentUuid = folderUuid;

    // 循环向上查找父级，直到没有 parentId 为止
    while (currentUuid && currentUuid !== 'root') {
      const folder = this.findFolderByUuidStmt.get(currentUuid);
      
      if (!folder) break;

      // 将当前文件夹加入数组开头 (确保顺序是：根 -> 子 -> 孙)
      breadcrumbs.unshift({
        uuid: folder.uuid,
        displayName: folder.displayName
      });

      // 向上移动一级
      currentUuid = folder.parentId;
    }

    // 在最前面加上“根目录”标识（可选，方便前端显示）
    breadcrumbs.unshift({ uuid: 'root', displayName: '全部文件' });
    
    return breadcrumbs;
  }
}

module.exports = new FileService();
