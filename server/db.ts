import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './config';

export type SettingKey = 'gemini_api_key' | 'gemini_model' | 'comfy_url' | 'comfy_workflow' | 'facebook_token' | 'facebook_pages';

const dataDir = getDataDir();
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'studio.sqlite3'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    caption TEXT NOT NULL,
    page_id TEXT,
    page_name TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL,
    published_at TEXT,
    status TEXT NOT NULL,
    facebook_post_id TEXT,
    error_message TEXT
  );
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
`);

export const database = db;

export function getSetting(key: SettingKey): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: SettingKey, value: string): void {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

export function deleteSetting(key: SettingKey): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function deleteOAuthState(state: string): void {
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
}

export function cleanupOAuthStates(): void {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(cutoff);
}
