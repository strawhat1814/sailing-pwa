import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
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

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
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

// Persistent store — Render free FS is wiped on sleep; MantleDB keeps subs alive.
const MANTLE_NS =
  process.env.MANTLE_NS || 'sailing-pwa-push-85985';
const MANTLE_KEY =
  process.env.MANTLE_KEY ||
  '18e90e41eded36301a77751173101767edc7d3a43835366ff0a6446e446d0b0c';
const MANTLE_PATH = process.env.MANTLE_PATH || 'store';
const MANTLE_URL = `https://mantledb.sh/v2/${MANTLE_NS}/${MANTLE_PATH}`;

const MAX_POOL = 40;

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

/** Keep pool under MantleDB 64KB free-tier limit. */
function compactPool(pool) {
  if (!Array.isArray(pool)) return [];
  return pool.slice(0, MAX_POOL).map((item) => {
    const choices = Array.isArray(item.choices)
      ? item.choices.slice(0, 4).map((c) => String(c).slice(0, 80))
      : undefined;
    const bodyRaw = String(item.body || '');
    // Drop duplicated numbered choices from body — SW rebuilds from choices[]
    const body = bodyRaw.split('\n')[0].slice(0, 180);
    return {
      termId: item.termId,
      title: String(item.title || '⛵ Ορολογία ιστιοπλοΐας').slice(0, 80),
      body,
      url: item.url,
      tag: item.tag,
      answer: item.answer ? String(item.answer).slice(0, 80) : undefined,
      choices,
    };
  });
}

async function loadStore() {
  try {
    const res = await fetch(MANTLE_URL, {
      headers: { 'X-Mantle-Key': MANTLE_KEY },
    });
    if (res.status === 404) return {};
    if (!res.ok) {
      console.error('mantle load', res.status, await res.text());
      return {};
    }
    const data = await res.json();
    if (data && typeof data === 'object' && data.subs && typeof data.subs === 'object') {
      return data.subs;
    }
    // legacy accidental shape
    if (data && typeof data === 'object' && !data.success && !data.error) {
      return data;
    }
    return {};
  } catch (err) {
    console.error('mantle load failed', err);
    return {};
  }
}

async function saveStore(store) {
  const payload = JSON.stringify({ v: 1, updatedAt: Date.now(), subs: store });
  if (payload.length > 60_000) {
    // Emergency shrink: drop pool tails
    for (const rec of Object.values(store)) {
      if (rec?.pool?.length > 20) rec.pool = rec.pool.slice(0, 20);
    }
  }
  const body = JSON.stringify({
    v: 1,
    updatedAt: Date.now(),
    subs: store,
  });
  const res = await fetch(MANTLE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mantle-Key': MANTLE_KEY,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('mantle save', res.status, text);
    throw new Error(`mantle save failed: ${res.status}`);
  }
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
        answer: payload.answer,
        choices: payload.choices,
      },
      adminContact: VAPID_SUBJECT,
      options: {
        ttl: 60 * 60,
        urgency: 'high',
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
  let failed = 0;
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
      } else {
        failed += 1;
        console.error('push bad status', key, status);
        record.nextAt = Date.now() + 60_000;
        dirty = true;
      }
    } catch (err) {
      failed += 1;
      console.error('push failed', key, err);
      record.nextAt = Date.now() + 60_000;
      dirty = true;
    }
  }

  if (dirty) await saveStore(store);
  return { sent, gone, failed };
}

async function statusPayload() {
  const store = await loadStore();
  const subs = Object.values(store);
  const now = Date.now();
  return {
    ok: true,
    storage: 'mantle',
    vapidPrivate: Boolean(VAPID_PRIVATE_JWK),
    subscribers: subs.length,
    enabled: subs.filter((s) => s.enabled).length,
    withPool: subs.filter((s) => s.pool?.length > 0).length,
    nextAt: subs
      .filter((s) => s.enabled)
      .map((s) => s.nextAt)
      .sort((a, b) => a - b)[0] || null,
    nextInSec: (() => {
      const n = subs
        .filter((s) => s.enabled && s.nextAt)
        .map((s) => s.nextAt)
        .sort((a, b) => a - b)[0];
      return n ? Math.max(0, Math.round((n - now) / 1000)) : null;
    })(),
  };
}

async function handle(req, res) {
  const origin = req.headers.origin;
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(origin));
    res.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    const tick = await deliverDue();
    const st = await statusPayload();
    sendJson(res, 200, { ...st, tick }, origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    sendJson(res, 200, await statusPayload(), origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/vapid-public-key') {
    sendJson(res, 200, { publicKey: VAPID_PUBLIC_KEY }, origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/tick') {
    const result = await deliverDue();
    sendJson(res, 200, result, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/subscribe') {
    if (!VAPID_PRIVATE_JWK) {
      sendJson(
        res,
        500,
        { error: 'VAPID_PRIVATE_JWK not set on server' },
        origin,
      );
      return;
    }

    const body = JSON.parse(await readBody(req));

    if (!body.subscription?.endpoint || !body.subscription.keys?.p256dh) {
      sendJson(res, 400, { error: 'invalid subscription' }, origin);
      return;
    }

    const intervalMinutes =
      typeof body.intervalMinutes === 'number' && body.intervalMinutes > 0
        ? body.intervalMinutes
        : 60;
    const pool = compactPool(body.pool);
    const enabled = body.enabled !== false;
    const key = subKey(body.subscription.endpoint);

    const wantImmediate = body.immediate !== false;
    const nextAt =
      Date.now() + (wantImmediate ? 45_000 : randomGapMs(intervalMinutes));

    const store = await loadStore();
    store[key] = {
      subscription: body.subscription,
      intervalMinutes,
      nextAt,
      pool,
      enabled,
      updatedAt: Date.now(),
    };
    await saveStore(store);

    let immediate = null;
    if (wantImmediate && enabled && pool.length) {
      try {
        const payload = pool[Math.floor(Math.random() * pool.length)];
        const status = await sendPush(body.subscription, payload);
        immediate = { status, ok: status >= 200 && status < 300 };
        if (status === 404 || status === 410) {
          delete store[key];
          await saveStore(store);
        } else if (immediate.ok) {
          store[key].nextAt = Date.now() + randomGapMs(intervalMinutes);
          await saveStore(store);
        } else {
          immediate.error = `FCM/push HTTP ${status}`;
        }
      } catch (err) {
        immediate = {
          ok: false,
          error: err instanceof Error ? err.message : 'push failed',
        };
      }
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        nextAt: store[key]?.nextAt ?? nextAt,
        poolSize: pool.length,
        storage: 'mantle',
        immediate,
      },
      origin,
    );
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
    if (!VAPID_PRIVATE_JWK) {
      sendJson(
        res,
        500,
        { error: 'VAPID_PRIVATE_JWK not set on server' },
        origin,
      );
      return;
    }
    const body = JSON.parse(await readBody(req));
    if (!body.endpoint) {
      sendJson(res, 400, { error: 'missing endpoint' }, origin);
      return;
    }
    const store = await loadStore();
    const record = store[subKey(body.endpoint)];
    if (!record) {
      sendJson(
        res,
        404,
        { error: 'not subscribed — tap Συγχρόνισε ξανά first' },
        origin,
      );
      return;
    }
    if (!record.pool.length) {
      sendJson(res, 400, { error: 'empty pool' }, origin);
      return;
    }
    const payload = record.pool[Math.floor(Math.random() * record.pool.length)];
    try {
      const status = await sendPush(record.subscription, payload);
      if (status === 404 || status === 410) {
        delete store[subKey(body.endpoint)];
        await saveStore(store);
        sendJson(res, 410, { error: 'subscription gone', status }, origin);
        return;
      }
      sendJson(
        res,
        200,
        { ok: status >= 200 && status < 300, status },
        origin,
      );
    } catch (err) {
      sendJson(
        res,
        500,
        {
          error: err instanceof Error ? err.message : 'push failed',
        },
        origin,
      );
    }
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
    'WARNING: VAPID_PRIVATE_JWK is not set — push send will fail.',
  );
}

createServer((req, res) => {
  void handle(req, res).catch((err) => {
    console.error(err);
    sendJson(res, 500, { error: 'internal error' }, req.headers.origin);
  });
}).listen(PORT, () => {
  console.log(`sailing-push listening on :${PORT}`);
  console.log(`vapidPrivate=${Boolean(VAPID_PRIVATE_JWK)} storage=mantle`);
});

const TICK_MS = Number(process.env.TICK_MS || 60_000);
setInterval(() => {
  void deliverDue().then((r) => {
    if (r.sent || r.gone || r.failed) console.log('tick', r);
  });
}, TICK_MS).unref?.();
