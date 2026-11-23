import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

export function getDataDir(): string {
  const configured = process.env.DATA_DIR?.trim() || '.data';
  const resolved = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

const isProduction = process.env.NODE_ENV === 'production';

export const serverConfig = {
  port: Number(process.env.PORT || 3001),
  frontendUrl: process.env.FRONTEND_URL || (isProduction ? process.env.APP_BASE_URL || 'http://localhost:3001' : 'http://localhost:5173'),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3001',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  comfyUrl: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
  comfyWorkflow: process.env.COMFYUI_WORKFLOW_JSON || '',
  comfyRuntime: process.env.COMFYUI_RUNTIME === 'cloud' ? 'cloud' : 'local',
  comfyTimeoutMs: Math.max(30_000, Number(process.env.COMFYUI_TIMEOUT_MS || 300_000)),
  comfyPollMs: Math.max(500, Number(process.env.COMFYUI_POLL_MS || 1000)),
  comfyMinVramGb: Math.max(0, Number(process.env.COMFYUI_MIN_VRAM_GB || 6)),
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaRedirectUri: process.env.META_REDIRECT_URI || 'http://localhost:3001/api/facebook/oauth/callback',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v21.0'
};
