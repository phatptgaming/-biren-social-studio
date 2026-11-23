export type View = 'overview' | 'create' | 'history' | 'connections' | 'settings';
export type Toast = { type: 'success' | 'error' | 'info'; message: string };
export type ServiceStatus = {
  gemini: { configured: boolean; model: string };
  comfy: { connected: boolean; configured: boolean; message: string; runtime?: 'local' | 'cloud'; url?: string; workflowSource?: 'default' | 'custom'; workflowValid?: boolean; workflowErrors?: string[]; workflowWarnings?: string[]; checkpointCount?: number | null; checkpoint?: string; nodesAvailable?: boolean; vramGb?: number | null };
  facebook: { configured: boolean; connected: boolean; pageCount: number; appConfigured: boolean };
};
export type MediaAsset = { fileName: string; originalName: string; mimeType: string; url: string };
export type ComfyJob = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; progress: number; message: string; result?: MediaAsset; error?: string; promptId?: string };

export type Page = { id: string; name: string; picture?: string };
export type HistoryPost = { id: string; caption: string; pageId: string | null; pageName: string | null; imageUrl: string | null; createdAt: string; publishedAt: string | null; status: 'published' | 'failed'; facebookPostId: string | null; errorMessage: string | null };
