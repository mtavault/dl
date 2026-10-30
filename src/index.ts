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

  app.get('/', (c) => c.text('ok'));

  app.use(
    'media/*',
    serveStatic({
      root: join(appConfig.storage_location, 'public'),
      rewriteRequestPath: (path) => path.replace(/^\/media/, ''),
      onFound: (_path, c) => {
        c.header('Cache-Control', 'public, max-age=2592000');
      },
    }),
  );

  app.get('map/:id', async (c) => {
    const id = c.req.param('id');
    const ipAddress = c.req.header('x-real-ip') || 'unknown';

    const child = logger.child({ ip: ipAddress, id });

    // Get data from API
    const url = new URL(`maps/${id}`, appConfig.mtavault_api);
    const response = await fetch(url.href);
    const body: APIResponse = await response.json();

    if (body.statusCode !== 200) {
      child.error('Map not found');
      throw new HTTPException(404, { message: 'Map not found' });
    }
    const map = body.data;

    // TODO: Do further permission check with the api to check for special permissions
    if (map.status !== 'PUBLIC') {
      child.error('Access denied');
      throw new HTTPException(401, { message: 'Unauthorized' });
    }

    // Get version name
    const requestedVersion = c.req.query('v');
    const version = requestedVersion ? map.versions.find((v) => v.number === requestedVersion) : map.versions.at(-1);
    const vChild = child.child({ version: version.number });
    if (!version) {
      vChild.error('Version not found');
      throw new HTTPException(404, { message: 'Version not found' });
    }

    // Construct filepath
    const filePath = join(appConfig.storage_location, 'private', map.id, version.number + '.zip');

    const fpChild = vChild.child({ filePath });

    // Check if file exists
    if (!existsSync(filePath)) {
      fpChild.error('File not found');
      throw new HTTPException(404, { message: 'File not found' });
    }
    vChild.info('Sending file');

    // Send file
    const file = Bun.file(filePath);

    const newFileName = map.fileName
      .replaceAll(/[.](?=.*[.])|(?![a-zA-Z0-9 _\[\].-])./g, '')
      .replaceAll(' - ', '_')
      .replaceAll(' ', '_');

    c.header('Cache-Control', 'public, max-age=2592000');
    c.header('Content-Disposition', `attachment; filename="${newFileName}.zip"`);

    return new Response(file, {
      headers: c.res.headers,
    });
  });

  Bun.serve({
    port: appConfig.port,
    fetch: app.fetch,
  });
}
