import { serverConfig } from '../config';
import { getSetting } from '../db';
import { uploadsDir } from '../storage';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type WorkflowNode = { class_type: string; inputs: Record<string, unknown> };
type Workflow = Record<string, WorkflowNode>;
type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown> }; name?: string }>;
type SystemStats = { devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }> };
export type ComfyAsset = { fileName: string; originalName: string; mimeType: string; url: string };
export type ComfyJob = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; progress: number; message: string; promptId?: string; result?: ComfyAsset; error?: string; checkpoint?: string; workflowSource?: 'default' | 'custom'; startedAt?: string; finishedAt?: string };
export type ComfyStatus = { connected: boolean; configured: boolean; message: string; runtime: 'local' | 'cloud'; url: string; workflowSource: 'default' | 'custom'; workflowValid: boolean; workflowErrors: string[]; workflowWarnings: string[]; checkpointCount: number | null; checkpoint?: string; nodesAvailable: boolean; vramGb?: number | null };

const jobs = new Map<string, ComfyJob>();
const MAX_JOBS = 200;
const defaultWorkflowPath = path.resolve(__dirname, 'workflows', 'product-enhance.json');
const sourceWorkflowPath = path.resolve(process.cwd(), 'server/providers/workflows/product-enhance.json');
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function baseUrl(): string { return (getSetting('comfy_url') || serverConfig.comfyUrl).replace(/\/$/, ''); }
function customWorkflowText(): string { return getSetting('comfy_workflow')?.trim() || serverConfig.comfyWorkflow.trim(); }
function isLocalUrl(url: string): boolean { try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; } }
function readDefaultWorkflow(): string {
  const file = fsSync.existsSync(defaultWorkflowPath) ? defaultWorkflowPath : sourceWorkflowPath;
  if (!fsSync.existsSync(file)) throw new Error('Không tìm thấy workflow mặc định của Biren Social Studio.');
  return fsSync.readFileSync(file, 'utf8');
}
export function defaultWorkflowText(): string { return readDefaultWorkflow(); }
export function workflowText(): { text: string; source: 'default' | 'custom' } { const custom = customWorkflowText(); return custom ? { text: custom, source: 'custom' } : { text: readDefaultWorkflow(), source: 'default' }; }

function parseWorkflow(text: string): Workflow {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Workflow ComfyUI không phải JSON hợp lệ.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Workflow ComfyUI phải là object API format.');
  const workflow: Workflow = {};
  for (const [id, node] of Object.entries(parsed)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`Node ${id} trong workflow không hợp lệ.`);
    const value = node as Record<string, unknown>;
    if (typeof value.class_type !== 'string' || !value.class_type.trim()) throw new Error(`Node ${id} thiếu class_type.`);
    if (!value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs)) throw new Error(`Node ${id} thiếu inputs.`);
    workflow[id] = { class_type: value.class_type, inputs: value.inputs as Record<string, unknown> };
  }
  if (!Object.keys(workflow).length) throw new Error('Workflow ComfyUI không có node.');
  return workflow;
}

export function validateWorkflowText(text: string): { valid: boolean; errors: string[]; warnings: string[] } {
  try {
    const parsedWorkflow = parseWorkflow(text);
    const errors: string[] = [];
    const warnings: string[] = [];
    const nodes = Object.values(parsedWorkflow);
    const loadNodes = nodes.filter((node) => node.class_type === 'LoadImage');
    if (!loadNodes.length) errors.push('Workflow phải có node LoadImage để nhận ảnh sản phẩm.');
    const hasInputPlaceholder = loadNodes.some((node) => typeof node.inputs.image === 'string' && node.inputs.image.includes('__INPUT_IMAGE__'));
    if (!hasInputPlaceholder) errors.push('Input image của node LoadImage phải dùng placeholder __INPUT_IMAGE__.');
    if (!nodes.some((node) => ['SaveImage', 'PreviewImage'].includes(node.class_type))) errors.push('Workflow phải có node SaveImage hoặc PreviewImage để tạo ảnh đầu ra.');
    if (!nodes.some((node) => node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced')) warnings.push('Workflow không có KSampler; hãy bảo đảm workflow thực sự tạo ảnh đầu ra.');
    const needsCheckpoint = nodes.some((node) => node.class_type === 'CheckpointLoaderSimple') || JSON.stringify(parsedWorkflow).includes('__CHECKPOINT__');
    if (!needsCheckpoint) warnings.push('Workflow không dùng checkpoint SD; hãy kiểm tra model đầu vào.');
    for (const node of nodes) {
      if (!['KSampler', 'KSamplerAdvanced'].includes(node.class_type)) continue;
      const denoise = typeof node.inputs.denoise === 'number' ? node.inputs.denoise : undefined;
      if (denoise !== undefined && denoise > 0.45) warnings.push('Denoise cao có thể làm thay đổi bao bì, logo hoặc chữ trên sản phẩm.');
    }
    return { valid: errors.length === 0, errors, warnings };
  } catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : 'Workflow không hợp lệ.'], warnings: [] }; }
}

function networkError(error: unknown): Error {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return new Error('ComfyUI phản hồi quá lâu hoặc đang bận.');
  return new Error(`Không kết nối được ComfyUI tại ${baseUrl()}. Hãy chạy "npm run comfy:start" hoặc kiểm tra địa chỉ trong Cài đặt.`);
}
async function fetchJson<T>(url: string, init?: RequestInit, timeout = 8000): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
  catch (error) { throw networkError(error); }
  const body = await response.text();
  let data: unknown = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body.slice(0, 300) }; }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'message' in data ? String((data as { message?: unknown }).message || '') : '';
    throw new Error(`ComfyUI trả về HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
  }
  return data as T;
}
async function objectInfo(): Promise<ObjectInfo> { return fetchJson<ObjectInfo>(`${baseUrl()}/object_info`, undefined, 15_000); }
async function systemStats(): Promise<SystemStats> { return fetchJson<SystemStats>(`${baseUrl()}/system_stats`, undefined, 5000); }
function checkpointOptions(info: ObjectInfo): string[] { const values = info.CheckpointLoaderSimple?.input?.required?.ckpt_name; return Array.isArray(values) && Array.isArray(values[0]) ? values[0].filter((item): item is string => typeof item === 'string') : []; }
function selectCheckpoint(info: ObjectInfo): string | undefined { const choices = checkpointOptions(info); const preferred = process.env.COMFYUI_CHECKPOINT?.trim(); if (preferred && choices.includes(preferred)) return preferred; return choices.find((name) => /\.(safetensors|ckpt|pt)$/i.test(name)) || choices[0]; }
function replacePlaceholders(value: unknown, imageName: string, checkpoint: string | undefined, seed: number): unknown {
  if (typeof value === 'string') {
    if (value === '__SEED__') return seed;
    if (value === '__CHECKPOINT__') return checkpoint || '__CHECKPOINT__';
    if (value.includes('__INPUT_IMAGE__')) return value.replaceAll('__INPUT_IMAGE__', imageName);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, imageName, checkpoint, seed));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, imageName, checkpoint, seed)]));
  return value;
}
function imageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}
async function uploadImage(imagePath: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  if (!imageMime(imageBuffer)) throw new Error('Tệp nguồn không phải ảnh JPG, PNG hoặc WebP hợp lệ.');
  const form = new FormData();
  form.append('image', new Blob([imageBuffer]), path.basename(imagePath));
  form.append('overwrite', 'true');
  const uploaded = await fetchJson<{ name?: string }>(`${baseUrl()}/upload/image`, { method: 'POST', body: form }, 30_000);
  if (!uploaded.name) throw new Error('ComfyUI không trả về tên ảnh đã tải lên.');
  return uploaded.name;
}
function updateJob(job: ComfyJob, message: string, progress: number): void { job.message = message; job.progress = Math.max(0, Math.min(100, Math.round(progress))); }
async function queuePrompt(workflow: Workflow): Promise<string> {
  const clientId = crypto.randomUUID();
  let response: Response;
  try { response = await fetch(`${baseUrl()}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }), signal: AbortSignal.timeout(15_000) }); }
  catch (error) { throw networkError(error); }
  const body = await response.text();
  let data: { prompt_id?: string; error?: string; node_errors?: unknown } = {};
  try { data = body ? JSON.parse(body) as typeof data : {}; } catch { /* handled below */ }
  if (!response.ok || !data.prompt_id) throw new Error(data.error || (data.node_errors ? `ComfyUI node errors: ${JSON.stringify(data.node_errors).slice(0, 500)}` : `ComfyUI không nhận workflow (HTTP ${response.status}).`));
  return data.prompt_id;
}
async function queueState(): Promise<{ queue_running?: unknown[]; queue_pending?: unknown[] }> { return fetchJson(`${baseUrl()}/queue`, undefined, 8000); }
async function history(promptId: string): Promise<Record<string, unknown> | null> {
  const data = await fetchJson<Record<string, Record<string, unknown>>>(`${baseUrl()}/history/${encodeURIComponent(promptId)}`, undefined, 8000);
  return data[promptId] || null;
}
function extractOutput(historyData: Record<string, unknown>): { filename: string; subfolder?: string; type?: string } | undefined {
  const outputs = historyData.outputs;
  if (!outputs || typeof outputs !== 'object') return undefined;
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (!node || typeof node !== 'object') continue;
    const images = (node as { images?: unknown }).images;
    if (!Array.isArray(images)) continue;
    const image = images.find((item): item is { filename: string; subfolder?: string; type?: string } => Boolean(item && typeof item === 'object' && typeof (item as { filename?: unknown }).filename === 'string'));
    if (image) return image;
  }
  return undefined;
}
async function saveOutput(output: { filename: string; subfolder?: string; type?: string }): Promise<ComfyAsset> {
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'output' });
  let response: Response;
  try { response = await fetch(`${baseUrl()}/view?${query.toString()}`, { signal: AbortSignal.timeout(30_000) }); }
  catch (error) { throw networkError(error); }
  if (!response.ok) throw new Error('Không tải được ảnh kết quả từ ComfyUI.');
  const headerMime = response.headers.get('content-type')?.split(';')[0] || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const detectedMime = imageMime(buffer);
  if (!detectedMime || (headerMime && !headerMime.startsWith('image/'))) throw new Error('ComfyUI trả về dữ liệu không phải ảnh hợp lệ.');
  if (buffer.length < 1024) throw new Error('Ảnh kết quả từ ComfyUI rỗng hoặc quá nhỏ.');
  const resultName = `processed-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${detectedMime === 'image/png' ? '.png' : detectedMime === 'image/jpeg' ? '.jpg' : '.webp'}`;
  await fs.writeFile(path.join(uploadsDir, resultName), buffer);
  return { fileName: resultName, originalName: resultName, mimeType: detectedMime, url: `/uploads/${encodeURIComponent(resultName)}` };
}
function historyError(data: Record<string, unknown>): string | undefined {
  const status = data.status;
  if (!status || typeof status !== 'object') return undefined;
  const statusValue = status as { status_str?: string; messages?: unknown[] };
  return statusValue.status_str === 'error' ? `ComfyUI báo workflow lỗi${statusValue.messages ? `: ${JSON.stringify(statusValue.messages).slice(0, 500)}` : '.'}` : undefined;
}
function pruneJobs(): void {
  if (jobs.size < MAX_JOBS) return;
  const finished = [...jobs.values()].filter((job) => job.status === 'completed' || job.status === 'failed').sort((a, b) => String(a.finishedAt || a.startedAt || '').localeCompare(String(b.finishedAt || b.startedAt || '')));
  for (const job of finished.slice(0, jobs.size - MAX_JOBS + 1)) jobs.delete(job.id);
}

async function executeJob(job: ComfyJob, imagePath: string): Promise<void> {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  updateJob(job, 'Đang kiểm tra ComfyUI và workflow…', 5);
  try {
    const selected = workflowText();
    const validation = validateWorkflowText(selected.text);
    if (!validation.valid) throw new Error(`Workflow không hợp lệ: ${validation.errors.join(' ')}`);
    const parsed = parseWorkflow(selected.text);
    job.workflowSource = selected.source;
    updateJob(job, 'Đang kiểm tra node, checkpoint và GPU…', 10);
    const info = await objectInfo();
    const classes = new Set(Object.keys(info));
    const missingNodes = [...new Set(Object.values(parsed).map((node) => node.class_type))].filter((classType) => !classes.has(classType));
    if (missingNodes.length) throw new Error(`ComfyUI thiếu node: ${missingNodes.join(', ')}. Hãy cập nhật ComfyUI hoặc workflow.`);
    const missingInputs: string[] = [];
    for (const [id, node] of Object.entries(parsed)) {
      const required = info[node.class_type]?.input?.required || {};
      for (const inputName of Object.keys(required)) if (!(inputName in node.inputs)) missingInputs.push(`${id}.${inputName}`);
    }
    if (missingInputs.length) throw new Error(`Workflow thiếu input bắt buộc: ${missingInputs.join(', ')}.`);
    const checkpoint = selectCheckpoint(info);
    const needsCheckpoint = Object.values(parsed).some((node) => node.class_type === 'CheckpointLoaderSimple') || JSON.stringify(parsed).includes('__CHECKPOINT__');
    if (needsCheckpoint && !checkpoint) throw new Error('ComfyUI chưa có checkpoint tương thích. Hãy cài một model hợp lệ vào ComfyUI/models/checkpoints rồi thử lại.');
    job.checkpoint = checkpoint;
    if (needsCheckpoint && !JSON.stringify(parsed).includes('__CHECKPOINT__')) {
      for (const node of Object.values(parsed)) {
        if (node.class_type === 'CheckpointLoaderSimple' && typeof node.inputs.ckpt_name === 'string' && !classes.has(node.inputs.ckpt_name)) node.inputs.ckpt_name = checkpoint;
      }
    }
    updateJob(job, 'Đang tải ảnh lên ComfyUI…', 20);
    const imageName = await uploadImage(imagePath);
    const prompt = replacePlaceholders(clone(parsed), imageName, checkpoint, crypto.randomInt(0, 2 ** 31 - 1)) as Workflow;
    updateJob(job, 'Đang xếp hàng workflow…', 30);
    job.promptId = await queuePrompt(prompt);
    const deadline = Date.now() + serverConfig.comfyTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, serverConfig.comfyPollMs));
      const completed = await history(job.promptId);
      const error = completed && historyError(completed);
      if (error) throw new Error(error);
      if (completed) {
        updateJob(job, 'Đã xử lý xong, đang tải ảnh kết quả…', 90);
        const output = extractOutput(completed);
        if (!output) throw new Error('Workflow ComfyUI không tạo ra ảnh kết quả.');
        job.result = await saveOutput(output);
        job.status = 'completed';
        job.progress = 100;
        job.message = 'ComfyUI đã tạo ảnh kết quả thật.';
        job.finishedAt = new Date().toISOString();
        return;
      }
      try {
        const queue = await queueState();
        const pending = (queue.queue_pending || []).length;
        updateJob(job, pending ? `Đang chờ ComfyUI (còn ${pending} job trước đó)…` : 'ComfyUI đang xử lý ảnh…', Math.min(88, Math.max(35, job.progress + 2)));
      } catch { updateJob(job, 'ComfyUI đang xử lý ảnh…', Math.min(88, job.progress + 1)); }
    }
    throw new Error('ComfyUI xử lý quá thời gian chờ. Không sử dụng ảnh giả hoặc ảnh chưa hoàn tất.');
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'ComfyUI xử lý thất bại.';
    job.message = job.error;
    job.finishedAt = new Date().toISOString();
  }
}
export function getComfyJob(id: string): ComfyJob | undefined { return jobs.get(id); }
export async function startComfyJob(imagePath: string): Promise<ComfyJob> {
  pruneJobs();
  const job: ComfyJob = { id: crypto.randomUUID(), status: 'queued', progress: 0, message: 'Đã nhận yêu cầu xử lý ảnh.' };
  jobs.set(job.id, job);
  void executeJob(job, imagePath);
  return job;
}
export async function processWithComfy(imagePath: string): Promise<ComfyAsset> {
  const job = await startComfyJob(imagePath);
  const deadline = Date.now() + serverConfig.comfyTimeoutMs + 10_000;
  while (Date.now() < deadline) {
    const current = jobs.get(job.id);
    if (current?.status === 'completed' && current.result) return current.result;
    if (current?.status === 'failed') throw new Error(current.error || current.message);
    await new Promise((resolve) => setTimeout(resolve, serverConfig.comfyPollMs));
  }
  throw new Error('ComfyUI xử lý quá thời gian chờ.');
}

export async function comfyStatus(): Promise<ComfyStatus> {
  const url = baseUrl();
  const selected = workflowText();
  const validation = validateWorkflowText(selected.text);
  const runtime: 'local' | 'cloud' = serverConfig.comfyRuntime === 'cloud' ? 'cloud' : 'local';
  if (runtime === 'cloud' && isLocalUrl(url)) return { connected: false, configured: false, message: 'Cloud mode không thể truy cập ComfyUI localhost. Hãy chạy Local Agent hoặc cấu hình remote worker an toàn.', runtime, url, workflowSource: selected.source, workflowValid: validation.valid, workflowErrors: validation.errors, workflowWarnings: validation.warnings, checkpointCount: null, nodesAvailable: false, vramGb: null };
  try {
    const stats = await systemStats();
    const info = await objectInfo();
    const checkpoints = checkpointOptions(info);
    const workflowErrors = [...validation.errors];
    const workflowWarnings = [...validation.warnings];
    let nodesAvailable = true;
    const device = stats.devices?.[0];
    const vramGb = device?.vram_total ? Math.round((device.vram_total / 1024 ** 3) * 10) / 10 : null;
    if (vramGb !== null && vramGb < serverConfig.comfyMinVramGb) workflowWarnings.push(`GPU chỉ có ${vramGb} GB VRAM; nên dùng workflow nhẹ hoặc giảm kích thước ảnh.`);
    if (validation.valid) {
      const parsed = parseWorkflow(selected.text);
      const classes = new Set(Object.keys(info));
      const missingNodes = [...new Set(Object.values(parsed).map((node) => node.class_type))].filter((classType) => !classes.has(classType));
      if (missingNodes.length) { nodesAvailable = false; workflowErrors.push(`ComfyUI thiếu node: ${missingNodes.join(', ')}.`); }
      const missingInputs: string[] = [];
      for (const [id, node] of Object.entries(parsed)) for (const inputName of Object.keys(info[node.class_type]?.input?.required || {})) if (!(inputName in node.inputs)) missingInputs.push(`${id}.${inputName}`);
      if (missingInputs.length) workflowErrors.push(`Workflow thiếu input bắt buộc: ${missingInputs.join(', ')}.`);
      const needsCheckpoint = Object.values(parsed).some((node) => node.class_type === 'CheckpointLoaderSimple') || JSON.stringify(parsed).includes('__CHECKPOINT__');
      if (needsCheckpoint && !checkpoints.length) workflowErrors.push('ComfyUI chưa có checkpoint tương thích.');
    }
    const configured = workflowErrors.length === 0;
    return {
      connected: true,
      configured,
      message: configured ? 'ComfyUI đã kết nối; workflow sẵn sàng.' : workflowErrors.some((item) => item.includes('checkpoint')) ? 'ComfyUI đã kết nối nhưng chưa có checkpoint.' : 'ComfyUI đã kết nối nhưng workflow cần sửa.',
      runtime,
      url,
      workflowSource: selected.source,
      workflowValid: validation.valid,
      workflowErrors,
      workflowWarnings,
      checkpointCount: checkpoints.length,
      checkpoint: selectCheckpoint(info),
      nodesAvailable,
      vramGb
    };
  } catch (error) {
    return {
      connected: false,
      configured: false,
      message: error instanceof Error && error.name === 'TimeoutError' ? 'ComfyUI phản hồi quá chậm hoặc đang bận.' : 'Không kết nối được ComfyUI. Chế độ giữ ảnh gốc vẫn dùng bình thường.',
      runtime,
      url,
      workflowSource: selected.source,
      workflowValid: validation.valid,
      workflowErrors: validation.errors,
      workflowWarnings: validation.warnings,
      checkpointCount: null,
      nodesAvailable: false,
      vramGb: null
    };
  }
}
