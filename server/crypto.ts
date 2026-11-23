import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './config';

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.APP_ENCRYPTION_KEY;
  if (configured) {
    cachedKey = crypto.createHash('sha256').update(configured).digest();
    return cachedKey;
  }
  const keyPath = path.join(getDataDir(), '.secret-key');
  fs.mkdirSync(getDataDir(), { recursive: true });
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), { encoding: 'utf8', flag: 'wx' });
  cachedKey = crypto.createHash('sha256').update(fs.readFileSync(keyPath, 'utf8')).digest();
  return cachedKey;
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value: string): string | null {
  try {
    const [ivEncoded, tagEncoded, dataEncoded] = value.split('.');
    if (!ivEncoded || !tagEncoded || !dataEncoded) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataEncoded, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
