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
    CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuidName TEXT NOT NULL,
        originalName TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        size INTEGER NOT NULL,
        bucket TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

db.exec(initScript);

console.log(`[DB] SQLite database connected at ${dbPath}`);

module.exports = db;
