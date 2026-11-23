import type { HistoryPost, MediaAsset, Page, ServiceStatus } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (HTTP ${response.status}).`);
  return data;
}

export const api = {
  status: () => request<ServiceStatus>('/status'),
  settings: () => request<{ comfyUrl: string; comfyWorkflowConfigured: boolean; geminiModel: string; metaConfigured: boolean }>('/settings'),
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
  processImage: (fileName: string) => request<MediaAsset>(`/media/${encodeURIComponent(fileName)}/process`, { method: 'POST' }),
  pages: () => request<{ pages: Page[] }>('/facebook/pages'),
  facebookStatus: () => request<ServiceStatus['facebook']>('/facebook/status'),
  facebookStart: () => request<{ url: string }>('/facebook/oauth/start'),
  facebookDisconnect: () => request<{ ok: boolean }>('/facebook/disconnect', { method: 'POST' }),
  posts: () => request<{ posts: HistoryPost[] }>('/posts'),
  publish: (caption: string, pageId: string, imageFileName?: string) => request<{ post: HistoryPost }>('/posts/publish', { method: 'POST', body: JSON.stringify({ caption, pageId, imageFileName }) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
};
