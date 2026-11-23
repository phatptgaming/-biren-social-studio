import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { database, deleteSetting, getSetting, setSetting } from '../db';
import { encryptSecret } from '../crypto';
import { safeUploadPath, uploadsDir } from '../storage';
import { serverConfig } from '../config';
import { generateCaption, getGeminiModel, testGemini } from '../providers/gemini';
import { comfyStatus, defaultWorkflowText, getComfyJob, processWithComfy, startComfyJob, validateWorkflowText, workflowText } from '../providers/comfy';
import { completeOAuth, disconnectFacebook, facebookStatus, listPages, oauthUrl, pageForPublish, publishToFacebook } from '../providers/facebook';
import type { HistoryPost } from '../types';

export const api = Router();

const imageExtensions: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${imageExtensions[file.mimetype] || '.img'}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(imageExtensions[file.mimetype]))
});

function imageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

function verifyImageFile(filePath: string): string {
  const handle = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const read = fs.readSync(handle, header, 0, header.length, 0);
    const detected = imageMime(header.subarray(0, read));
    if (!detected) throw new Error('Tệp tải lên không phải ảnh JPG, PNG hoặc WebP hợp lệ.');
    return detected;
  } finally { fs.closeSync(handle); }
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} không được để trống.`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${field} vượt quá ${maxLength} ký tự.`);
  return result;
}

function safeFile(fileName: string): string {
  if (!/^[\w.-]+$/.test(fileName)) throw new Error('Tên tệp không hợp lệ.');
  const filePath = safeUploadPath(fileName);
  if (!fs.existsSync(filePath)) throw new Error('Không tìm thấy ảnh đã tải lên.');
  verifyImageFile(filePath);
  return filePath;
}

function postFromRow(row: Record<string, unknown>): HistoryPost {
  return { id: String(row.id), caption: String(row.caption), pageId: row.page_id ? String(row.page_id) : null, pageName: row.page_name ? String(row.page_name) : null, imageUrl: row.image_url ? String(row.image_url) : null, createdAt: String(row.created_at), publishedAt: row.published_at ? String(row.published_at) : null, status: row.status as HistoryPost['status'], facebookPostId: row.facebook_post_id ? String(row.facebook_post_id) : null, errorMessage: row.error_message ? String(row.error_message) : null };
}

api.get('/health', (_req, res) => res.json({ ok: true, service: 'biren-social-studio', time: new Date().toISOString() }));

api.get('/status', async (_req, res, next) => {
  try {
    const comfy = await comfyStatus();
    const facebook = facebookStatus();
    res.json({ gemini: { configured: Boolean(getSetting('gemini_api_key') || serverConfig.geminiApiKey), model: getGeminiModel() }, comfy, facebook });
  } catch (error) { next(error); }
});

api.get('/settings/comfy/workflow', (_req, res, next) => {
  try { const workflow = defaultWorkflowText(); res.json({ workflow, validation: validateWorkflowText(workflow) }); } catch (error) { next(error); }
});


api.get('/settings', (_req, res) => {
  const selected = workflowText(); const validation = validateWorkflowText(selected.text);
  res.json({ comfyUrl: getSetting('comfy_url') || serverConfig.comfyUrl, comfyWorkflowConfigured: validation.valid, comfyWorkflowSource: selected.source, comfyWorkflow: selected.source === 'custom' ? selected.text : '', comfyWorkflowErrors: validation.errors, geminiModel: getGeminiModel(), metaConfigured: facebookStatus().appConfigured });
});

api.put('/settings/gemini', (req, res, next) => {
  try {
    const { apiKey, model } = req.body as { apiKey?: unknown; model?: unknown };
    if (typeof apiKey === 'string' && apiKey.trim()) setSetting('gemini_api_key', encryptSecret(apiKey.trim()));
    if (typeof model === 'string' && model.trim()) setSetting('gemini_model', text(model, 'Model Gemini', 120));
    res.json({ ok: true, message: 'Đã lưu cấu hình Gemini an toàn.' });
  } catch (error) { next(error); }
});

api.post('/settings/gemini/test', async (req, res, next) => {
  try {
    const apiKey = typeof req.body?.apiKey === 'string' && req.body.apiKey.trim() ? req.body.apiKey.trim() : undefined;
    res.json(await testGemini(apiKey));
  } catch (error) { next(error); }
});

api.put('/settings/comfy', (req, res, next) => {
  try {
    const { url, workflow } = req.body as { url?: unknown; workflow?: unknown };
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) throw new Error('Địa chỉ ComfyUI phải bắt đầu bằng http:// hoặc https://.');
    if (typeof workflow === 'string' && workflow.trim()) {
      const validation = validateWorkflowText(workflow.trim());
      if (!validation.valid) throw new Error(`Workflow không hợp lệ: ${validation.errors.join(' ')}`);
      setSetting('comfy_workflow', workflow.trim());
    } else if (workflow === '') deleteSetting('comfy_workflow');
    setSetting('comfy_url', url.trim().replace(/\/$/, ''));
    res.json({ ok: true, message: 'Đã lưu cấu hình ComfyUI.' });
  } catch (error) { next(error); }
});

api.post('/settings/comfy/test', async (_req, res, next) => {
  try { res.json(await comfyStatus()); } catch (error) { next(error); }
});

api.post('/content/generate', async (req, res, next) => {
  try {
    const input = text(req.body?.input, 'Nội dung đầu vào', 10000);
    const action = ['generate', 'rewrite', 'shorten', 'variant'].includes(req.body?.action) ? req.body.action : 'generate';
    res.json({ content: await generateCaption(input, action) });
  } catch (error) { next(error); }
});

api.post('/media/upload', (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (error) {
      if (req.file?.path) fs.rm(req.file.path, { force: true }, () => undefined);
      if ((error as { code?: string }).code === 'LIMIT_FILE_SIZE') return next(new Error('Ảnh vượt quá giới hạn 10 MB.'));
      return next(error);
    }
    if (!req.file) return next(new Error('Chỉ nhận ảnh JPG, PNG hoặc WebP tối đa 10 MB.'));
    try {
      const detectedMime = verifyImageFile(req.file.path);
      const id = crypto.randomUUID();
      database.prepare('INSERT INTO media (id, file_name, original_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?)').run(id, req.file.filename, req.file.originalname, detectedMime, new Date().toISOString());
      res.status(201).json({ id, fileName: req.file.filename, originalName: req.file.originalname, mimeType: detectedMime, url: `/uploads/${encodeURIComponent(req.file.filename)}` });
    } catch (validationError) {
      fs.rm(req.file.path, { force: true }, () => undefined);
      next(validationError);
    }
  });
});

api.post('/media/:fileName/process/start', async (req, res, next) => {
  try { const source = safeFile(req.params.fileName); const job = await startComfyJob(source); res.status(202).json({ job }); } catch (error) { next(error); }
});

api.get('/media/process/:jobId', (req, res, next) => {
  try { const job = getComfyJob(req.params.jobId); if (!job) return res.status(404).json({ error: 'Không tìm thấy job ComfyUI.' }); res.json({ job }); } catch (error) { next(error); }
});

api.post('/media/:fileName/process', async (req, res, next) => {
  try {
    const source = safeFile(req.params.fileName);
    const output = await processWithComfy(source);
    res.json({ ...output, url: `/uploads/${encodeURIComponent(output.fileName)}` });
  } catch (error) { next(error); }
});

api.get('/facebook/status', (_req, res) => res.json(facebookStatus()));
api.get('/facebook/pages', (_req, res) => res.json({ pages: listPages() }));
api.get('/facebook/oauth/start', (_req, res, next) => { try { res.json({ url: oauthUrl() }); } catch (error) { next(error); } });
api.get('/facebook/oauth/callback', async (req, res) => {
  const redirect = serverConfig.frontendUrl;
  try {
    if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string') throw new Error('Meta OAuth callback thiếu code hoặc state.');
    await completeOAuth(req.query.code, req.query.state);
    res.redirect(`${redirect}/?facebook=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kết nối Facebook thất bại.';
    res.redirect(`${redirect}/?facebook=error&message=${encodeURIComponent(message.slice(0, 180))}`);
  }
});
api.post('/facebook/disconnect', (_req, res) => { disconnectFacebook(); res.json({ ok: true }); });

api.get('/posts', (_req, res) => {
  const rows = database.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100').all() as Record<string, unknown>[];
  res.json({ posts: rows.map(postFromRow) });
});

api.delete('/posts/:id', (req, res, next) => {
  try { database.prepare('DELETE FROM posts WHERE id = ?').run(text(req.params.id, 'Mã bài viết', 80)); res.json({ ok: true }); } catch (error) { next(error); }
});

api.post('/posts/publish', async (req, res, next) => {
  let postId = '';
  try {
    const caption = text(req.body?.caption, 'Nội dung bài viết', 10000);
    const pageId = text(req.body?.pageId, 'Fanpage', 100);
    const page = pageForPublish(pageId);
    if (!page) throw new Error('Fanpage chưa được kết nối hoặc quyền đã hết hạn.');
    const imageFileName = typeof req.body?.imageFileName === 'string' && req.body.imageFileName ? req.body.imageFileName : undefined;
    const imagePath = imageFileName ? safeFile(imageFileName) : undefined;
    postId = crypto.randomUUID();
    const now = new Date().toISOString();
    database.prepare('INSERT INTO posts (id, caption, page_id, page_name, image_url, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(postId, caption, page.id, page.name, imageFileName ? `/uploads/${encodeURIComponent(imageFileName)}` : null, now, 'failed');
    const facebookPostId = await publishToFacebook(page, caption, imagePath);
    database.prepare('UPDATE posts SET status = ?, published_at = ?, facebook_post_id = ?, error_message = NULL WHERE id = ?').run('published', new Date().toISOString(), facebookPostId || null, postId);
    res.json({ ok: true, post: postFromRow(database.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as Record<string, unknown>) });
  } catch (error) {
    if (postId) database.prepare('UPDATE posts SET error_message = ? WHERE id = ?').run(error instanceof Error ? error.message : 'Đăng bài thất bại.', postId);
    next(error);
  }
});

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
  const status = /file|tệp|ảnh|workflow|node|checkpoint|comfyui|gemini|api key|meta app|fanpage|không được để trống|chưa được cấu hình|vượt quá|JSON hợp lệ|địa chỉ/i.test(message) ? 400 : 500;
  if (status >= 500) console.error('[api]', message);
  res.status(status).json({ error: message });
}