const db = require("../config/db"); // 引入刚才改写的 db
const { s3Client, BUCKET_NAME } = require("../config/s3");
const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const path = require("path");
const archiver = require("archiver");

class FileService {
  constructor() {
    // --- 1. 文件夹相关 SQL ---
    this.createFolderStmt = db.prepare(`
        INSERT INTO folders (uuid, displayName, parentId)
        VALUES (?, ?, ?)
    `);
    this.listRootFoldersStmt = db.prepare(
      "SELECT * FROM folders WHERE parentId IS NULL ORDER BY displayName ASC",
    );
    this.listSubFoldersStmt = db.prepare(
      "SELECT * FROM folders WHERE parentId = ? ORDER BY displayName ASC",
    );
    this.findFolderByUuidStmt = db.prepare(
      "SELECT * FROM folders WHERE uuid = ?",
    );
    this.deleteFolderStmt = db.prepare("DELETE FROM folders WHERE uuid = ?");

    // --- 2. 文件相关 SQL ---
    this.insertFileStmt = db.prepare(`
        INSERT INTO files (uuidName, originalName, mimetype, size, bucket, folderUuid)
        VALUES (@uuidName, @originalName, @mimetype, @size, @bucket, @folderUuid)
    `);
    this.listFilesByFolderStmt = db.prepare(
      "SELECT * FROM files WHERE folderUuid = ? ORDER BY id DESC",
    );
    this.listRootFilesStmt = db.prepare(
      "SELECT * FROM files WHERE folderUuid = 'root' ORDER BY id DESC",
    );
    this.findFileByIdStmt = db.prepare("SELECT * FROM files WHERE id = ?");
    this.deleteFileStmt = db.prepare("DELETE FROM files WHERE id = ?");
    this.listAllStmt = db.prepare("SELECT * FROM files ORDER BY id DESC");

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
    // 1. 递归获取所有需要删除的文件和文件夹 UUID
    const allFileKeys = [];
    const allFolderUuids = [uuid];

    const collectRecursive = (currentUuid) => {
      // 获取当前文件夹下的文件
      const files = this.listFilesByFolderStmt.all(currentUuid);
      files.forEach((f) => allFileKeys.push({ Key: f.uuidName }));

      // 获取子文件夹
      const subFolders = this.listSubFoldersStmt.all(currentUuid);
      subFolders.forEach((sf) => {
        allFolderUuids.push(sf.uuid);
        collectRecursive(sf.uuid);
      });
    };

    collectRecursive(uuid);

    // 2. 批量从 S3 删除物理文件
    if (allFileKeys.length > 0) {
      console.log(
        `[Recursive Delete] 正在批量清理 S3 文件，共 ${allFileKeys.length} 个...`,
      );
      try {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: { Objects: allFileKeys },
          }),
        );
      } catch (error) {
        console.error(`[Delete Error] S3 批量删除失败:`, error.message);
        throw new Error(`云端文件删除失败，操作已中止。`);
      }
    }

    // 3. 利用事务从数据库删除 (确保原子性)
    const deleteTransaction = db.transaction(() => {
      const deleteFilesByFolder = db.prepare(
        "DELETE FROM files WHERE folderUuid = ?",
      );
      for (const fUuid of allFolderUuids) {
        deleteFilesByFolder.run(fUuid);
      }
      // 手动按层级逆序删除文件夹 (由深到浅)
      for (let i = allFolderUuids.length - 1; i >= 0; i--) {
        this.deleteFolderStmt.run(allFolderUuids[i]);
      }
    });

    deleteTransaction();

    console.log(`[Recursive Delete] 文件夹及其内容已彻底清除: ${uuid}`);
    return {
      uuid,
      filesDeleted: allFileKeys.length,
      foldersDeleted: allFolderUuids.length,
    };
  }

  // --- 文件夹下载 (ZIP) ---
  async getFolderZipStream(folderUuid) {
    const rootFolder = this.findFolderByUuidStmt.get(folderUuid);
    if (!rootFolder) throw new Error("FOLDER_NOT_FOUND");

    const archive = archiver("zip", { zlib: { level: 5 } });
    
    // 递归收集所有文件并加入压缩包
    const appendRecursive = async (currentUuid, relativePath) => {
      // 1. 获取当前文件夹下的文件
      const files = this.listFilesByFolderStmt.all(currentUuid);
      for (const file of files) {
        try {
          const response = await s3Client.send(new GetObjectCommand({
            Bucket: file.bucket,
            Key: file.uuidName
          }));
          // 将文件流加入 zip，指定在压缩包内的完整路径
          archive.append(response.Body, { name: path.join(relativePath, file.originalName) });
        } catch (err) {
          console.error(`[Zip Error] 无法读取文件 ${file.originalName}:`, err.message);
        }
      }

      // 2. 获取子文件夹并递归
      const subFolders = this.listSubFoldersStmt.all(currentUuid);
      for (const folder of subFolders) {
        await appendRecursive(folder.uuid, path.join(relativePath, folder.displayName));
      }
    };

    // 开始递归处理 (后台运行)
    (async () => {
      try {
        await appendRecursive(folderUuid, "");
        await archive.finalize();
      } catch (e) {
        archive.emit('error', e);
      }
    })();

    return { stream: archive, filename: rootFolder.displayName };
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
