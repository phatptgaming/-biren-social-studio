import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './config';

export const uploadsDir = path.join(getDataDir(), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

export function safeUploadPath(fileName: string): string {
  const resolved = path.resolve(uploadsDir, fileName);
  if (!resolved.startsWith(path.resolve(uploadsDir) + path.sep)) throw new Error('Đường dẫn tệp không hợp lệ.');
  return resolved;
}
