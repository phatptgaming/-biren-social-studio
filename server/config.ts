import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

export function getDataDir(): string {
  const configured = process.env.DATA_DIR?.trim() || '.data';
  const resolved = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export const serverConfig = {
  port: Number(process.env.PORT || 3001),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3001',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  comfyUrl: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
  comfyWorkflow: process.env.COMFYUI_WORKFLOW_JSON || '',
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaRedirectUri: process.env.META_REDIRECT_URI || 'http://localhost:3001/api/facebook/oauth/callback',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v21.0'
};
