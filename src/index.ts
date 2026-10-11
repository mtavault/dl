import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { poweredBy } from 'hono/powered-by';
import appConfig from '../app.config';
import { HTTPException } from 'hono/http-exception';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const dateFormatter = new Intl.DateTimeFormat([], { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', second: 'numeric', minute: 'numeric', hour: 'numeric' });

if (cluster.isPrimary) {
  const instances = availableParallelism();
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

  app.get('map/:id', async (c) => {
    const id = c.req.param('id');
    const url = new URL(`maps/${id}`, appConfig.mtavault_api);
    const response = await fetch(url.href);
    const { data: map } = await response.json();

    // TODO: Do further permission check with the api to check for special permissions
    if (map.status !== 'PUBLIC') throw new HTTPException(401, { message: 'Unauthorized' });

    const requestedVersion = c.req.query('v');
    const version = requestedVersion ? map.versions.find((v) => v.number === requestedVersion) : map.versions.at(-1);
    if (!version) throw new HTTPException(404, { message: 'Version not found' });

    const filePath = join(appConfig.storage_location, '.maps', map.id, version.number + '.zip');

    console.debug(`[${dateFormatter.format(new Date())}] ${filePath}`);
    if (!existsSync(filePath)) throw new HTTPException(404, { message: 'File not found' });

    c.header('Cache-Control', 'public, max-age=2592000');
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: c.res.headers,
    });
  });

  Bun.serve({
    port: appConfig.port,
    fetch: app.fetch,
  });
}
