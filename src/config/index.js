const path = require('path');
const fs = require('fs');

// 1. 环境识别
const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

// 2. 尝试加载环境特定的 .env 文件 (如 .env.production)
const envFile = isProduction ? '.env.production' : '.env';
const envPath = path.resolve(process.cwd(), envFile);

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // 如果特定环境文件不存在，尝试加载通用的 .env
  require('dotenv').config();
}

const config = {
  env,
  isProduction,
  port: parseInt(process.env.PORT, 10) || 3300,
  
  db: {
    path: process.env.DATABASE_PATH || './data/file-server.db',
  },

  s3: {
    // 关键：地址解耦逻辑
    // 开发环境默认使用 19000 端口，生产环境默认使用容器内的 9000 端口
    endpoint: process.env.RUSTFS_ENDPOINT || 
      (isProduction ? 'http://rustfs-storage:9000' : 'http://localhost:19000'),
    
    // 浏览器访问地址：开发环境默认 19000
    publicEndpoint: process.env.RUSTFS_PUBLIC_ENDPOINT || 
      process.env.RUSTFS_ENDPOINT || 
      (isProduction ? 'http://localhost:9000' : 'http://localhost:19000'),
    
    region: process.env.RUSTFS_REGION || 'us-east-1',
    bucket: process.env.RUSTFS_BUCKET_NAME || 'bucket',
    credentials: {
      accessKeyId: process.env.RUSTFS_ACCESS_KEY || 'rustfsadmin',
      secretAccessKey: process.env.RUSTFS_SECRET_KEY || 'rustfsadmin',
    },
  },
};

// 启动时打印关键配置，方便排查地址问题
console.log(`[Config] Environment: ${config.env}`);
console.log(`[Config] S3 Internal Endpoint: ${config.s3.endpoint}`);
console.log(`[Config] S3 Public Endpoint: ${config.s3.publicEndpoint}`);

module.exports = config;
