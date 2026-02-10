const fileService = require("../services/fileService");

// --- 文件夹管理 ---

// 创建文件夹
exports.createFolder = async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name) return res.status(400).json({ error: "文件夹名称不能为空" });

    const folder = await fileService.createFolder(name, parentId);
    res.status(201).json(folder);
  } catch (error) {
    res.status(500).json({ error: "创建文件夹失败" });
  }
};

// 获取目录内容 (同时返回文件夹和文件)
exports.getContent = async (req, res) => {
  try {
    const { folderUuid } = req.query; // 根目录传 null 或不传
    const content = await fileService.getFolderContent(folderUuid);
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: "获取目录内容失败" });
  }
};

// 递归删除文件夹
exports.removeFolder = async (req, res) => {
  try {
    const { uuid } = req.params;
    const result = await fileService.deleteFolder(uuid);
    res.json({ message: "文件夹及其子内容已彻底删除", data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "删除文件夹失败" });
  }
};

// --- 模式 A: 服务器中转 ---
exports.upload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择文件" });

    const { folderUuid } = req.body;
    const result = await fileService.uploadFileViaServer(req.file, folderUuid);
    res.status(201).json({ message: "上传成功", data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "上传失败" });
  }
};

// --- 模式 B: 高效预签名 (推荐) ---
// 1. 前端请求上传地址
exports.getUploadUrl = async (req, res) => {
  try {
    const { filename, mimetype } = req.body;
    if (!filename || !mimetype)
      return res.status(400).json({ error: "需要 filename 和 mimetype" });

    const data = await fileService.getPresignedUploadUrl(filename, mimetype);
    res.json(data);
    // 前端拿到 url 后，直接 PUT file 到这个 url
  } catch (error) {
    res.status(500).json({ error: "获取预签名失败" });
  }
};

// 2. 前端上传完成后通知后端
exports.uploadCallback = async (req, res) => {
  try {
    // key(uuid), originalName, mimetype, size
    // req.body 应包含: key, originalName, mimetype, size, folderUuid
    const result = await fileService.saveFileMetadata(req.body);
    res.status(201).json({ message: "元数据保存成功", data: result });
  } catch (error) {
    res.status(500).json({ error: "保存失败" });
  }
};

// --- 通用 ---
exports.list = async (req, res) => {
  const files = await fileService.getAllFiles();
  res.json(files);
};

exports.remove = async (req, res) => {
  try {
    await fileService.deleteFile(parseInt(req.params.id));
    res.json({ message: "删除成功" });
  } catch (error) {
    res.status(500).json({ error: "删除失败" });
  }
};

// --- 模式 A: 服务器中转下载 ---
exports.downloadStream = async (req, res) => {
  try {
    const { stream, meta } = await fileService.getDownloadStream(
      parseInt(req.params.id),
    );
    // 设置强制下载头
    res.setHeader("Content-Type", meta.mimetype);
    const encodedName = encodeURIComponent(meta.originalName);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodedName}`,
    );
    stream.pipe(res);
  } catch (error) {
    if (error.message.includes("NOT_FOUND"))
      return res.status(404).send("文件不存在");
    res.status(500).send("下载失败");
  }
};

// --- 模式 B: 获取预签名下载链接 (核心) ---
exports.getDownloadUrl = async (req, res) => {
  try {
    // 调用 service 生成一个有效期 1 小时的 RustFS 直链
    const { url, filename } = await fileService.getPresignedDownloadUrl(
      parseInt(req.params.id),
    );
    res.json({ url, filename });
  } catch (error) {
    res.status(500).json({ error: "获取链接失败" });
  }
};

exports.getBreadcrumbs = async (req, res) => {
  try {
    const { folderUuid } = req.query;
    
    // 如果没有 uuid，直接返回根目录面包屑
    if (!folderUuid || folderUuid === 'root') {
      return res.json([{ uuid: 'root', displayName: '全部文件' }]);
    }

    const breadcrumbs = await fileService.getBreadcrumbs(folderUuid);
    res.json(breadcrumbs);
  } catch (error) {
    res.status(500).json({ error: "获取面包屑失败" });
  }
};
