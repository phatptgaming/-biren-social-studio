import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('server/providers/workflows');
const target = path.resolve('dist/server/providers/workflows');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Copied ComfyUI workflows to ${target}`);
