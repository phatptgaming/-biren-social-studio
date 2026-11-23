import crypto from 'node:crypto';
import { serverConfig } from '../config';
import { cleanupOAuthStates, deleteSetting, getSetting, setSetting, database } from '../db';
import { decryptSecret, encryptSecret } from '../crypto';
import type { PageInfo } from '../types';

const STATE_TTL_MS = 15 * 60 * 1000;
function graphUrl(pathname: string): string { return `https://graph.facebook.com/${serverConfig.metaGraphVersion}${pathname}`; }
function appSecretProof(token: string): string | undefined {
  if (!serverConfig.metaAppSecret) return undefined;
  return crypto.createHmac('sha256', serverConfig.metaAppSecret).update(token).digest('hex');
}
async function graphJson<T>(url: string, init?: RequestInit, timeout = 30_000): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
  catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Meta Graph API phản hồi quá lâu.');
    throw new Error('Không kết nối được Meta Graph API. Kiểm tra mạng và cấu hình Meta App.');
  }
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok || data.error) throw new Error(data.error?.message || `Meta trả về HTTP ${response.status}.`);
  return data;
}
function storedPages(): PageInfo[] {
  const raw = getSetting('facebook_pages');
  if (!raw) return [];
  const value = decryptSecret(raw);
  if (!value) return [];
  try { return JSON.parse(value) as PageInfo[]; } catch { return []; }
}
function normalizePages(pages: Array<PageInfo & { picture?: unknown }>): PageInfo[] {
  return pages.map((page) => {
    const picture = page.picture && typeof page.picture === 'object' ? (page.picture as { data?: { url?: string } }).data?.url : undefined;
    return { id: String(page.id), name: String(page.name), accessToken: typeof page.accessToken === 'string' ? page.accessToken : undefined, picture: typeof page.picture === 'string' ? page.picture : picture };
  });
}

export function facebookStatus() {
  const pages = storedPages();
  const appConfigured = Boolean(serverConfig.metaAppId && serverConfig.metaAppSecret);
  return { configured: appConfigured, connected: pages.length > 0, pageCount: pages.length, appConfigured };
}

export function oauthUrl(): string {
  if (!serverConfig.metaAppId || !serverConfig.metaAppSecret) throw new Error('Meta App chưa được cấu hình ở backend.');
  cleanupOAuthStates();
  const state = crypto.randomBytes(32).toString('hex');
  database.prepare('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)').run(state, new Date().toISOString());
  const params = new URLSearchParams({ client_id: serverConfig.metaAppId, redirect_uri: serverConfig.metaRedirectUri, state, response_type: 'code', scope: 'pages_show_list,pages_read_engagement,pages_manage_posts' });
  return `https://www.facebook.com/${serverConfig.metaGraphVersion}/dialog/oauth?${params.toString()}`;
}

export async function completeOAuth(code: string, state: string): Promise<void> {
  const stateRow = database.prepare('SELECT created_at FROM oauth_states WHERE state = ?').get(state) as { created_at: string } | undefined;
  database.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  if (!stateRow) throw new Error('OAuth state không hợp lệ hoặc đã được sử dụng.');
  if (Date.now() - Date.parse(stateRow.created_at) > STATE_TTL_MS) throw new Error('OAuth state đã hết hạn. Hãy kết nối lại Facebook.');
  const tokenParams = new URLSearchParams({ client_id: serverConfig.metaAppId, client_secret: serverConfig.metaAppSecret, redirect_uri: serverConfig.metaRedirectUri, code });
  const tokenData = await graphJson<{ access_token?: string }>(graphUrl('/oauth/access_token'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenParams.toString() });
  if (!tokenData.access_token) throw new Error('Meta không cấp được access token.');
  const params = new URLSearchParams({ fields: 'id,name,access_token,picture', access_token: tokenData.access_token });
  const proof = appSecretProof(tokenData.access_token);
  if (proof) params.set('appsecret_proof', proof);
  const pagesData = await graphJson<{ data?: Array<PageInfo & { picture?: unknown }> }>(`${graphUrl('/me/accounts')}?${params.toString()}`);
  if (!pagesData.data) throw new Error('Không lấy được danh sách Fanpage.');
  if (!pagesData.data.length) throw new Error('Tài khoản Meta chưa có Fanpage phù hợp hoặc chưa cấp quyền pages_show_list.');
  setSetting('facebook_pages', encryptSecret(JSON.stringify(normalizePages(pagesData.data))));
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
    const proof = appSecretProof(page.accessToken);
    if (proof) form.append('appsecret_proof', proof);
    form.append('source', new Blob([await fs.readFile(imagePath)]), imagePath.split(/[\\/]/).pop() || 'image');
    response = await fetch(graphUrl(endpoint), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  } else {
    const params = new URLSearchParams({ message: caption, access_token: page.accessToken });
    const proof = appSecretProof(page.accessToken);
    if (proof) params.set('appsecret_proof', proof);
    response = await fetch(`${graphUrl(endpoint)}?${params.toString()}`, { method: 'POST', signal: AbortSignal.timeout(60_000) });
  }
  const data = await response.json().catch(() => ({})) as { id?: string; post_id?: string; error?: { message?: string; code?: number } };
  if (!response.ok || data.error) throw new Error(data.error?.message || `Meta trả về HTTP ${response.status}.`);
  return data.post_id || data.id || '';
}
