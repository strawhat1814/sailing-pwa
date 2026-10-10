import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPushHTTPRequest } from '@pushforge/builder';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load KEY=VALUE from .env into process.env (does not override existing env). */
function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(join(__dirname, '.env'));

const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const SUBS_FILE = join(DATA_DIR, 'subscriptions.json');

const PORT = Number(
  process.env.SERVER_PORT || process.env.PORT || 3000,
);
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BKPjkYH16YAQmBxARvV_IjRTsAhHRMSbLA8zcPY1--ULq8H-m9e7DJ1ZX7VyZFF7IrVlQuBEOlYmEjsA-2fg220';
const VAPID_PRIVATE_JWK = process.env.VAPID_PRIVATE_JWK || '';
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'mailto:sailing-pwa@users.noreply.github.com';
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'https://strawhat1814.github.io,http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function subKey(endpoint) {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) {
    h = (Math.imul(31, h) + endpoint.charCodeAt(i)) | 0;
  }
  return `sub:${(h >>> 0).toString(16)}:${endpoint.length}`;
}

function randomGapMs(intervalMinutes) {
  const base = intervalMinutes * 60 * 1000;
  const min = Math.max(45_000, Math.floor(base * 0.4));
  const max = Math.max(min + 15_000, Math.floor(base * 1.6));
  return min + Math.floor(Math.random() * (max - min));
}

async function loadStore() {
  try {
    const raw = await readFile(SUBS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SUBS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function cors(origin) {
  const ok =
    origin &&
    ALLOWED_ORIGINS.some((a) => origin === a || origin.startsWith(`${a}/`));
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : ALLOWED_ORIGINS[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJson(res, status, data, origin) {
  const headers = {
    'Content-Type': 'application/json',
    ...cors(origin),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function sendPush(subscription, payload) {
  if (!VAPID_PRIVATE_JWK) {
    throw new Error('VAPID_PRIVATE_JWK is not set');
  }
  const privateJWK = JSON.parse(VAPID_PRIVATE_JWK);
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK,
    subscription,
    message: {
      payload: {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        termId: payload.termId,
        tag: payload.tag || `sailing-${payload.termId}-${Date.now()}`,
      },
      adminContact: VAPID_SUBJECT,
      options: {
        ttl: 60 * 60,
        urgency: 'normal',
      },
    },
  });

  const res = await fetch(endpoint, { method: 'POST', headers, body });
  return res.status;
}

async function deliverDue() {
  const store = await loadStore();
  let sent = 0;
  let gone = 0;
  let dirty = false;

  for (const [key, record] of Object.entries(store)) {
    if (!record.enabled || !record.pool?.length) continue;
    if (Date.now() < (record.nextAt || 0)) continue;

    const idx = Math.floor(Math.random() * record.pool.length);
    const payload = record.pool[idx];
    try {
      const status = await sendPush(record.subscription, payload);
      if (status === 404 || status === 410) {
        delete store[key];
        gone += 1;
        dirty = true;
        continue;
      }
      if (status >= 200 && status < 300) {
        sent += 1;
        record.nextAt = Date.now() + randomGapMs(record.intervalMinutes || 60);
        record.updatedAt = Date.now();
        dirty = true;
      }
    } catch (err) {
      console.error('push failed', key, err);
    }
  }

  if (dirty) await saveStore(store);
  return { sent, gone };
}

async function handle(req, res) {
  const origin = req.headers.origin;
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(origin));
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true }, origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/vapid-public-key') {
    sendJson(res, 200, { publicKey: VAPID_PUBLIC_KEY }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/subscribe') {
    const body = JSON.parse(await readBody(req));

    if (!body.subscription?.endpoint || !body.subscription.keys?.p256dh) {
      sendJson(res, 400, { error: 'invalid subscription' }, origin);
      return;
    }

    const intervalMinutes =
      typeof body.intervalMinutes === 'number' && body.intervalMinutes > 0
        ? body.intervalMinutes
        : 60;
    const pool = Array.isArray(body.pool) ? body.pool.slice(0, 120) : [];
    const enabled = body.enabled !== false;
    const key = subKey(body.subscription.endpoint);

    const store = await loadStore();
    const prev = store[key];
    let nextAt = Date.now() + randomGapMs(intervalMinutes);
    if (prev?.nextAt && prev.nextAt > Date.now()) nextAt = prev.nextAt;

    store[key] = {
      subscription: body.subscription,
      intervalMinutes,
      nextAt,
      pool,
      enabled,
      updatedAt: Date.now(),
    };
    await saveStore(store);
    sendJson(res, 200, { ok: true, nextAt, poolSize: pool.length }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/unsubscribe') {
    const body = JSON.parse(await readBody(req));
    if (!body.endpoint) {
      sendJson(res, 400, { error: 'missing endpoint' }, origin);
      return;
    }
    const store = await loadStore();
    delete store[subKey(body.endpoint)];
    await saveStore(store);
    sendJson(res, 200, { ok: true }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/test') {
    const body = JSON.parse(await readBody(req));
    if (!body.endpoint) {
      sendJson(res, 400, { error: 'missing endpoint' }, origin);
      return;
    }
    const store = await loadStore();
    const record = store[subKey(body.endpoint)];
    if (!record) {
      sendJson(res, 404, { error: 'not subscribed' }, origin);
      return;
    }
    if (!record.pool.length) {
      sendJson(res, 400, { error: 'empty pool' }, origin);
      return;
    }
    const payload = record.pool[Math.floor(Math.random() * record.pool.length)];
    const status = await sendPush(record.subscription, payload);
    if (status === 404 || status === 410) {
      delete store[subKey(body.endpoint)];
      await saveStore(store);
      sendJson(res, 410, { error: 'subscription gone', status }, origin);
      return;
    }
    sendJson(res, 200, { ok: status >= 200 && status < 300, status }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/tick') {
    const result = await deliverDue();
    sendJson(res, 200, result, origin);
    return;
  }

  sendJson(res, 404, { error: 'not found' }, origin);
}

if (!VAPID_PRIVATE_JWK) {
  console.warn(
    'WARNING: VAPID_PRIVATE_JWK is not set — /subscribe will work, push send will fail.',
  );
}

createServer((req, res) => {
  void handle(req, res).catch((err) => {
    console.error(err);
    sendJson(res, 500, { error: 'internal error' }, req.headers.origin);
  });
}).listen(PORT, () => {
  console.log(`sailing-push listening on :${PORT}`);
});

const TICK_MS = Number(process.env.TICK_MS || 120_000);
setInterval(() => {
  void deliverDue().then((r) => {
    if (r.sent || r.gone) console.log('tick', r);
  });
}, TICK_MS).unref?.();
