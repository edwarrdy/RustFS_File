/*
 * @Author: edward jifengming92@163.com
 * @Date: 2026-01-21 15:16:00
 * @LastEditors: edward jifengming92@163.com
 * @LastEditTime: 2026-02-10 15:50:30
 * @FilePath: \RustFS_File\src\config\db.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const Database = require("better-sqlite3");
const path = require("path");

// 数据库文件路径 (自动创建)
const dbPath = path.join(__dirname, "../../file-server.db");
const db = new Database(dbPath); // verbose: console.log 可开启日志

// 开启 WAL 模式 (大幅提升并发读写性能，生产环境建议开启)
db.pragma("journal_mode = WAL");

// 初始化表结构 (代替了 prisma migrate)
// 我们直接用 SQL 语句创建表
const initScript = `
    CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,       -- 用于 S3 路径
        displayName TEXT NOT NULL,       -- 用户看到的名称
        parentId TEXT DEFAULT NULL,      -- 指向父文件夹的 uuid,根目录为 NULL
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parentId) REFERENCES folders(uuid) ON DELETE CASCADE
    );



    CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuidName TEXT NOT NULL,
        originalName TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        size INTEGER NOT NULL,
        bucket TEXT NOT NULL,
        folderUuid TEXT NOT NULL,        -- 文件所属文件夹的 uuid
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

db.exec(initScript);

// 2. 核心修复逻辑：检查并更名/添加字段
try {
  const tableInfo = db.prepare("PRAGMA table_info(files)").all();
  const hasFolderUuid = tableInfo.some(
    (column) => column.name === "folderUuid",
  );
  const hasOldFolder = tableInfo.some((column) => column.name === "folder");

  if (!hasFolderUuid) {
    if (hasOldFolder) {
      // 如果有旧的 folder 字段，将其更名为 folderUuid
      console.log("[DB] 正在将字段 'folder' 重命名为 'folderUuid'...");
      db.exec("ALTER TABLE files RENAME COLUMN folder TO folderUuid");
    } else {
      // 如果连旧字段都没有，直接添加
      console.log("[DB] 正在添加缺失的 'folderUuid' 字段...");
      db.exec("ALTER TABLE files ADD COLUMN folderUuid TEXT DEFAULT 'root'");
    }
  }
} catch (err) {
  console.error("[DB] 自动迁移失败，请检查数据库权限或手动修改:", err.message);
}

console.log(`[DB] SQLite database connected at ${dbPath}`);

module.exports = db;
