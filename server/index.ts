import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { serverConfig } from './config';
import { api, errorHandler } from './routes/api';
import { uploadsDir } from './storage';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: serverConfig.frontendUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadsDir, { index: false, dotfiles: 'deny' }));
app.use('/api', api);

if (process.env.NODE_ENV === 'production') {
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
}
app.use(errorHandler);

app.listen(serverConfig.port, () => {
  console.log(`Biren Social Studio API đang chạy tại http://localhost:${serverConfig.port}`);
});

export default app;
