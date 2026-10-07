import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import cors from 'cors';
import express from 'express';
import { configureStateStore, getState, runAction } from './core.js';
import { openDatabase } from './db/index.js';
import { createPushService } from './push.js';
import { fetchStayPreview } from './stay-preview.js';

const here = dirname(fileURLToPath(import.meta.url));
const databasePath = resolve(process.env.DATABASE_PATH || resolve(here, '../data/twogether.db'));
const distPath = resolve(here, '../../dist');
const port = Number(process.env.PORT) || 4310;
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGIN || 'http://localhost:5180,http://127.0.0.1:5180')
    .split(',').map((value) => value.trim()).filter(Boolean),
);

const database = openDatabase(databasePath);
configureStateStore(database.store);
const pushService = createPushService({
  db: database.db,
  readState: () => database.db.transaction(() => getState())(),
});

const app = express();
const liveClients = new Map();
let liveClientSeq = 0;
const liveHeartbeat = setInterval(() => {
  for (const client of liveClients.values()) {
    try { client.res.write(': keepalive\n\n'); } catch {}
  }
}, 25000);
liveHeartbeat.unref?.();

function broadcastStateChange(sourceClientId = '') {
  for (const client of liveClients.values()) {
    if (sourceClientId && client.clientId === sourceClientId) continue;
    try { client.res.write('event: state\ndata: {}\n\n'); } catch {}
  }
}
// Vite's build always marks the module script and stylesheet tags
// `crossorigin`, which makes browsers send an Origin header even for
// same-origin requests -- so in production (this server serving both the
// app and the API from one origin), the app's own requests must always be
// allowed regardless of ALLOWED_ORIGIN. That env var only matters for local
// dev, where the frontend (Vite, :5180) and this API (:4310) really are
// different origins.
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  let sameOrigin = false;
  if (requestOrigin) {
    try { sameOrigin = new URL(requestOrigin).host === req.headers.host; } catch {}
  }
  cors({
    origin(origin, callback) {
      if (!origin || sameOrigin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed'));
    },
  })(req, res, next);
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, version: 18, now: new Date().toISOString() });
});

app.get('/api/events', (req, res) => {
  const clientId = String(req.query.client || '').slice(0, 120);
  const key = (clientId || 'anonymous') + ':' + (++liveClientSeq);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 1500\n\n');
  liveClients.set(key, { clientId, res });
  req.on('close', () => liveClients.delete(key));
});

app.post('/api/stays/preview', async (req, res) => {
  try {
    res.json(await fetchStayPreview(req.body?.url));
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || 'Could not read accommodation details from this link' });
  }
});

app.get('/api/push/public-key', (_req, res) => {
  res.json({ ok:true, publicKey:pushService.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  try {
    const { actor, subscription, timezone } = req.body || {};
    res.json(pushService.subscribe(actor, subscription, timezone));
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || 'Could not enable phone notifications' });
  }
});

app.delete('/api/push/subscribe', (req, res) => {
  try {
    res.json(pushService.unsubscribe(req.body?.endpoint));
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || 'Could not disable phone notifications' });
  }
});

app.post('/api/push/messages', (req, res) => {
  try {
    res.json(pushService.claim(req.body?.endpoint));
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || 'Could not load phone notifications' });
  }
});

app.post('/api/push/test', (req, res) => {
  try {
    res.json(pushService.scheduleTest(req.body?.endpoint));
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || 'Could not schedule test notification' });
  }
});

// Serves the built frontend (npm run build -> dist/) so one process can
// answer both the app and the API in production. In local dev, run the
// frontend separately with `npm run dev` (Vite, hot reload) instead --
// scripts/dev.js runs both this server and Vite together.
app.use(express.static(distPath));

app.get('/api/state', (_req, res) => {
  try {
    const state = database.db.transaction(() => getState())();
    res.json({ ok: true, state });
  } catch (error) {
    res.json({ ok: false, error: error?.message || 'Could not read the database' });
  }
});

app.post('/api/action', (req, res) => {
  try {
    const { action, actor, payload = {}, clientId = '' } = req.body || {};
    const result = database.db.transaction(() => runAction(action, payload, actor))();
    res.json(result);
    if (result?.ok) broadcastStateChange(String(clientId || '').slice(0, 120));
    if (result?.ok) pushService.evaluateSoon();
  } catch (error) {
    res.json({ ok: false, error: error?.message || 'Could not save the change' });
  }
});

app.use((error, _req, res, _next) => {
  res.status(error?.type === 'entity.parse.failed' ? 400 : 500).json({
    ok: false,
    error: error?.type === 'entity.parse.failed' ? 'Invalid JSON request' : (error?.message || 'Server error'),
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Twogether database running at http://localhost:${port}`);
  console.log(`SQLite file: ${databasePath}`);
});

function shutdown() {
  clearInterval(liveHeartbeat);
  pushService.close();
  for (const client of liveClients.values()) {
    try { client.res.end(); } catch {}
  }
  liveClients.clear();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
