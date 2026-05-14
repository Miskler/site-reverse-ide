import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { GraphStore } from './graph-store';
import { GraphValidationError } from './graph-schema';

const rootDir = process.cwd();
const clientDir = path.resolve(rootDir, 'dist', 'client');
const graphPath = path.resolve(rootDir, 'instance', 'graph.json');
const hasClientBuild = existsSync(path.join(clientDir, 'index.html'));

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'info',
  },
});

const store = new GraphStore(graphPath);

app.get('/api/health', async () => {
  return { status: 'ok' };
});

app.get('/api/graph', async () => {
  return store.load();
});

app.post('/api/graph', async (request, reply) => {
  try {
    const saved = await store.save(request.body);
    return saved;
  } catch (error) {
    if (error instanceof GraphValidationError) {
      return reply.code(400).send({ error: error.message });
    }

    request.log.error(error);
    return reply.code(500).send({ error: 'Failed to save graph' });
  }
});

if (hasClientBuild) {
  app.register(fastifyStatic, {
    root: clientDir,
    prefix: '/',
    index: false,
  });

  app.get('/', async (_request, reply) => {
    return reply.sendFile('index.html');
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }

    if (request.method === 'GET' && !path.extname(request.url)) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({ error: 'Not found' });
  });
} else {
  app.get('/', async (_request, reply) => {
    return reply
      .type('text/html; charset=utf-8')
      .send(
        '<!doctype html><html lang="ru"><body><h1>Canvas Links</h1><p>Сначала запусти <code>npm run build</code>, чтобы собрать React-клиент.</p></body></html>',
      );
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: 'Not found' });
  });
}

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3000');

async function start() {
  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
