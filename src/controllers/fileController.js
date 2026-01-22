const fileService = require("../services/fileService");

// --- 模式 A: 服务器中转 ---
exports.upload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择文件" });
    const result = await fileService.uploadFileViaServer(req.file);
    res.status(201).json({ message: "上传成功", data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "上传失败" });
  }
};

exports.downloadStream = async (req, res) => {
  try {
    const { stream, meta } = await fileService.getDownloadStream(
      parseInt(req.params.id),
    );
    res.setHeader("Content-Type", meta.mimetype);
    // 使用 RFC 5987 标准格式，防止中文乱码
    const encodedName = encodeURIComponent(meta.originalName);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodedName}`,
    );
    stream.pipe(res);
  } catch (error) {
    if (error.message.includes("NOT_FOUND"))
      return res.status(404).json({ error: "文件未找到" });
    res.status(500).json({ error: "下载失败" });
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(meta.originalName)}"`,
    );
    stream.pipe(res);
  } catch (error) {
    if (error.message.includes("NOT_FOUND"))
      return res.status(404).send("文件不存在");
    res.status(500).send("下载出错");
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
