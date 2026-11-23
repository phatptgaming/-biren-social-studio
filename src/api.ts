import type { HistoryPost, MediaAsset, Page, ServiceStatus } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (HTTP ${response.status}).`);
  return data;
}

export const api = {
  status: () => request<ServiceStatus>('/status'),
  settings: () => request<{ comfyUrl: string; comfyWorkflowConfigured: boolean; comfyWorkflowSource: 'default' | 'custom'; comfyWorkflow: string; comfyWorkflowErrors: string[]; geminiModel: string; metaConfigured: boolean }>('/settings'),
  generate: (input: string, action: string) => request<{ content: string }>('/content/generate', { method: 'POST', body: JSON.stringify({ input, action }) }),
  saveGemini: (apiKey: string, model: string) => request<{ message: string }>('/settings/gemini', { method: 'PUT', body: JSON.stringify({ apiKey, model }) }),
  testGemini: (apiKey?: string) => request<{ model: string; message: string }>('/settings/gemini/test', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  saveComfy: (url: string, workflow: string) => request<{ message: string }>('/settings/comfy', { method: 'PUT', body: JSON.stringify({ url, workflow }) }),
  testComfy: () => request<{ connected: boolean; configured: boolean; message: string }>('/settings/comfy/test', { method: 'POST' }),
  upload: async (file: File): Promise<MediaAsset> => {
    const form = new FormData(); form.append('image', file);
    const response = await fetch('/api/media/upload', { method: 'POST', body: form });
    const data = await response.json() as MediaAsset & { error?: string };
    if (!response.ok) throw new Error(data.error || 'Tải ảnh thất bại.');
    return data;
  },
  startComfy: (fileName: string) => request<{ job: import('./types').ComfyJob }>(`/media/${encodeURIComponent(fileName)}/process/start`, { method: 'POST' }),
  comfyJob: (jobId: string) => request<{ job: import('./types').ComfyJob }>(`/media/process/${encodeURIComponent(jobId)}`),
  processImage: async (fileName: string, onProgress?: (progress: number, message: string) => void): Promise<MediaAsset> => {
    const { job: started } = await request<{ job: import('./types').ComfyJob }>(`/media/${encodeURIComponent(fileName)}/process/start`, { method: 'POST' });
    onProgress?.(started.progress, started.message);
    const deadline = Date.now() + 330000;
    while (Date.now() < deadline) {
      const { job } = await request<{ job: import('./types').ComfyJob }>(`/media/process/${encodeURIComponent(started.id)}`);
      onProgress?.(job.progress, job.message);
      if (job.status === 'completed' && job.result) return job.result;
      if (job.status === 'failed') throw new Error(job.error || job.message || 'ComfyUI xử lý thất bại.');
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error('ComfyUI xử lý quá thời gian chờ.');
  },
  pages: () => request<{ pages: Page[] }>('/facebook/pages'),
  facebookStatus: () => request<ServiceStatus['facebook']>('/facebook/status'),
  facebookStart: () => request<{ url: string }>('/facebook/oauth/start'),
  facebookDisconnect: () => request<{ ok: boolean }>('/facebook/disconnect', { method: 'POST' }),
  posts: () => request<{ posts: HistoryPost[] }>('/posts'),
  publish: (caption: string, pageId: string, imageFileName?: string) => request<{ post: HistoryPost }>('/posts/publish', { method: 'POST', body: JSON.stringify({ caption, pageId, imageFileName }) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
};
