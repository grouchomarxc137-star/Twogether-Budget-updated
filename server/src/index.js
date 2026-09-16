import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import cors from 'cors';
import express from 'express';
import { configureStateStore, getState, runAction } from './core.js';
import { openDatabase } from './db/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const databasePath = resolve(process.env.DATABASE_PATH || resolve(here, '../data/twogether.db'));
const port = Number(process.env.PORT) || 4310;
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGIN || 'http://localhost:5180,http://127.0.0.1:5180')
    .split(',').map((value) => value.trim()).filter(Boolean),
);

const database = openDatabase(databasePath);
configureStateStore(database.store);

const app = express();
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, version: 18, now: new Date().toISOString() });
});

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
    const { action, actor, payload = {} } = req.body || {};
    const result = database.db.transaction(() => runAction(action, payload, actor))();
    res.json(result);
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
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
