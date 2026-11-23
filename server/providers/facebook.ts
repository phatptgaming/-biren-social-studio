import crypto from 'node:crypto';
import { serverConfig } from '../config';
import { deleteSetting, getSetting, setSetting, database } from '../db';
import { decryptSecret, encryptSecret } from '../crypto';
import type { PageInfo } from '../types';

function graphUrl(pathname: string): string { return `https://graph.facebook.com/${serverConfig.metaGraphVersion}${pathname}`; }
function storedPages(): PageInfo[] {
  const raw = getSetting('facebook_pages');
  if (!raw) return [];
  const value = decryptSecret(raw);
  if (!value) return [];
  try { return JSON.parse(value) as PageInfo[]; } catch { return []; }
}

export function facebookStatus() {
  const pages = storedPages();
  return { configured: Boolean(serverConfig.metaAppId && serverConfig.metaAppSecret), connected: pages.length > 0, pageCount: pages.length, appConfigured: Boolean(serverConfig.metaAppId && serverConfig.metaAppSecret) };
}

export function oauthUrl(): string {
  if (!serverConfig.metaAppId || !serverConfig.metaAppSecret) throw new Error('Meta App chưa được cấu hình ở backend.');
  const state = crypto.randomBytes(32).toString('hex');
  database.prepare('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)').run(state, new Date().toISOString());
  const params = new URLSearchParams({ client_id: serverConfig.metaAppId, redirect_uri: serverConfig.metaRedirectUri, state, response_type: 'code', scope: 'pages_show_list,pages_read_engagement,pages_manage_posts' });
  return `https://www.facebook.com/${serverConfig.metaGraphVersion}/dialog/oauth?${params.toString()}`;
}

export async function completeOAuth(code: string, state: string): Promise<void> {
  const stateRow = database.prepare('SELECT state FROM oauth_states WHERE state = ?').get(state);
  database.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  if (!stateRow) throw new Error('OAuth state không hợp lệ hoặc đã hết hạn.');
  const tokenParams = new URLSearchParams({ client_id: serverConfig.metaAppId, client_secret: serverConfig.metaAppSecret, redirect_uri: serverConfig.metaRedirectUri, code });
  const tokenResponse = await fetch(`${graphUrl('/oauth/access_token')}?${tokenParams.toString()}`);
  const tokenData = await tokenResponse.json() as { access_token?: string; error?: { message?: string } };
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error?.message || 'Meta không cấp được access token.');
  const pagesResponse = await fetch(`${graphUrl('/me/accounts')}?fields=id,name,access_token,picture&access_token=${encodeURIComponent(tokenData.access_token)}`);
  const pagesData = await pagesResponse.json() as { data?: PageInfo[]; error?: { message?: string } };
  if (!pagesResponse.ok || !pagesData.data) throw new Error(pagesData.error?.message || 'Không lấy được danh sách Fanpage.');
  setSetting('facebook_pages', encryptSecret(JSON.stringify(pagesData.data)));
}

export function listPages(): PageInfo[] { return storedPages().map(({ id, name, picture }) => ({ id, name, picture })); }
export function pageForPublish(pageId: string): PageInfo | undefined { return storedPages().find((page) => page.id === pageId); }
export function disconnectFacebook(): void { deleteSetting('facebook_pages'); }

export async function publishToFacebook(page: PageInfo, caption: string, imagePath?: string): Promise<string> {
  if (!page.accessToken) throw new Error('Fanpage không có quyền đăng bài. Hãy kết nối lại Facebook.');
  const endpoint = imagePath ? `/${page.id}/photos` : `/${page.id}/feed`;
  let response: Response;
  if (imagePath) {
    const fs = await import('node:fs/promises');
    const form = new FormData();
    form.append('message', caption);
    form.append('access_token', page.accessToken);
    form.append('source', new Blob([await fs.readFile(imagePath)]), imagePath.split(/[\\/]/).pop() || 'image');
    response = await fetch(graphUrl(endpoint), { method: 'POST', body: form });
  } else {
    const params = new URLSearchParams({ message: caption, access_token: page.accessToken });
    response = await fetch(`${graphUrl(endpoint)}?${params.toString()}`, { method: 'POST' });
  }
  const data = await response.json() as { id?: string; post_id?: string; error?: { message?: string; code?: number } };
  if (!response.ok || data.error) throw new Error(data.error?.message || `Meta trả về HTTP ${response.status}.`);
  return data.post_id || data.id || '';
}
