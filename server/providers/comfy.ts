import { serverConfig } from '../config';
import { getSetting } from '../db';
import { uploadsDir } from '../storage';
import fs from 'node:fs/promises';
import path from 'node:path';

function baseUrl(): string {
  return (getSetting('comfy_url') || serverConfig.comfyUrl).replace(/\/$/, '');
}

function workflowConfig(): string {
  return getSetting('comfy_workflow') || serverConfig.comfyWorkflow;
}

export async function comfyStatus(): Promise<{ connected: boolean; configured: boolean; message: string }> {
  try {
    const response = await fetch(`${baseUrl()}/system_stats`, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) return { connected: false, configured: Boolean(workflowConfig()), message: `ComfyUI trả về HTTP ${response.status}.` };
    return { connected: true, configured: Boolean(workflowConfig()), message: workflowConfig() ? 'ComfyUI đã kết nối và có workflow.' : 'ComfyUI đã kết nối nhưng chưa có workflow.' };
  } catch {
    return { connected: false, configured: Boolean(workflowConfig()), message: 'Không kết nối được ComfyUI. Chế độ giữ ảnh gốc vẫn dùng bình thường.' };
  }
}

function replaceInput(value: unknown, imageName: string): unknown {
  if (typeof value === 'string') return value.replaceAll('__INPUT_IMAGE__', imageName);
  if (Array.isArray(value)) return value.map((item) => replaceInput(item, imageName));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceInput(item, imageName)]));
  return value;
}

export async function processWithComfy(imagePath: string): Promise<{ fileName: string; originalName: string; mimeType: string }> {
  const workflowText = workflowConfig();
  if (!workflowText) throw new Error('Chưa cấu hình workflow ComfyUI.');
  let workflow: Record<string, unknown>;
  try { workflow = JSON.parse(workflowText) as Record<string, unknown>; } catch { throw new Error('Workflow ComfyUI không phải JSON hợp lệ.'); }
  const imageBuffer = await fs.readFile(imagePath);
  const uploadForm = new FormData();
  uploadForm.append('image', new Blob([imageBuffer]), path.basename(imagePath));
  uploadForm.append('overwrite', 'true');
  const uploadResponse = await fetch(`${baseUrl()}/upload/image`, { method: 'POST', body: uploadForm });
  if (!uploadResponse.ok) throw new Error(`ComfyUI không nhận được ảnh (HTTP ${uploadResponse.status}).`);
  const uploaded = await uploadResponse.json() as { name?: string };
  if (!uploaded.name) throw new Error('ComfyUI không trả về tên ảnh đã tải lên.');
  const promptResponse = await fetch(`${baseUrl()}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: replaceInput(workflow, uploaded.name) }) });
  const promptData = await promptResponse.json() as { prompt_id?: string; error?: string };
  if (!promptResponse.ok || !promptData.prompt_id) throw new Error(promptData.error || `ComfyUI không nhận workflow (HTTP ${promptResponse.status}).`);
  const promptId = promptData.prompt_id;
  let history: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const historyResponse = await fetch(`${baseUrl()}/history/${encodeURIComponent(promptId)}`);
    if (!historyResponse.ok) continue;
    const historyData = await historyResponse.json() as Record<string, any>;
    if (historyData[promptId]) { history = historyData[promptId]; break; }
  }
  if (!history) throw new Error('ComfyUI xử lý quá thời gian chờ.');
  const outputs = history.outputs as Record<string, any> | undefined;
  const output = outputs && Object.values(outputs).flatMap((node) => (node.images || [])).find((item: any) => item.filename);
  if (!output?.filename) throw new Error('Workflow ComfyUI không tạo ra ảnh kết quả.');
  const imageResponse = await fetch(`${baseUrl()}/view?filename=${encodeURIComponent(output.filename)}&subfolder=${encodeURIComponent(output.subfolder || '')}&type=${encodeURIComponent(output.type || 'output')}`);
  if (!imageResponse.ok) throw new Error('Không tải được ảnh kết quả từ ComfyUI.');
  const resultBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const resultName = `processed-${Date.now()}-${path.basename(output.filename)}`;
  await fs.writeFile(path.join(uploadsDir, resultName), resultBuffer);
  return { fileName: resultName, originalName: resultName, mimeType: imageResponse.headers.get('content-type')?.split(';')[0] || 'image/png' };
}
