import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { poweredBy } from 'hono/powered-by';
import appConfig from '../app.config';
import { HTTPException } from 'hono/http-exception';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import pino from 'pino';
import { APIResponse } from './types/api-response';
import { serveStatic } from '@hono/bun';
import { cors } from 'hono/cors';

const logger = pino({
  timestamp: pino.stdTimeFunctions.isoTime,
  name: cluster.isWorker ? `worker ${cluster.worker?.id}` : 'primary',
  transport: {
    target: 'pino-pretty',
  },
});

if (cluster.isPrimary) {
  const instances = availableParallelism();
  logger.info(`starting ${instances} workers`);
  for (let i = 0; i < instances; i++) {
    cluster.fork();
  }
} else {
  const app = new Hono();

  app.use(poweredBy());
  app.use(
    compress({
      threshold: 1024,
    }),
  );

  app.use(
    cors({
      origin: '*',
      credentials: false,
      maxAge: 86400,
    }),
  );

  app.get('/', (c) => c.text('ok'));

  app.use(
    '*',
    serveStatic({
      root: join(appConfig.storage_location, 'public'),
      // rewriteRequestPath: (path) => path.replace(/^\/media/, ''),
      onFound: (_path, c) => {
        c.header('Cache-Control', 'public, max-age=2592000');
      },
    }),
  );

  Bun.serve({
    port: appConfig.port,
    fetch: app.fetch,
  });
}
