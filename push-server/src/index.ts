import { buildPushHTTPRequest } from '@pushforge/builder';

export interface Env {
  SUBS: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  /** JSON string of JWK private key */
  VAPID_PRIVATE_JWK: string;
  VAPID_SUBJECT: string;
  ALLOWED_ORIGINS: string;
}

type PushPayload = {
  termId: string;
  title: string;
  body: string;
  url: string;
  tag?: string;
};

type SubRecord = {
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  };
  intervalMinutes: number;
  nextAt: number;
  pool: PushPayload[];
  enabled: boolean;
  updatedAt: number;
};

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok =
    origin &&
    allowed.some((a) => origin === a || origin.startsWith(`${a}/`));
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, init: ResponseInit = {}, origin: string | null = null, env?: Env) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (env) {
    for (const [k, v] of Object.entries(corsHeaders(origin, env))) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function subKey(endpoint: string): string {
  // KV key length limits — hash endpoint
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) {
    h = (Math.imul(31, h) + endpoint.charCodeAt(i)) | 0;
  }
  return `sub:${(h >>> 0).toString(16)}:${endpoint.length}`;
}

function randomGapMs(intervalMinutes: number): number {
  const base = intervalMinutes * 60 * 1000;
  const min = Math.max(45_000, Math.floor(base * 0.4));
  const max = Math.max(min + 15_000, Math.floor(base * 1.6));
  return min + Math.floor(Math.random() * (max - min));
}

async function sendPush(
  env: Env,
  subscription: SubRecord['subscription'],
  payload: PushPayload,
): Promise<number> {
  const privateJWK = JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey;
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
      adminContact: env.VAPID_SUBJECT,
      options: {
        ttl: 60 * 60,
        urgency: 'normal',
      },
    },
  });

  const res = await fetch(endpoint, { method: 'POST', headers, body });
  return res.status;
}

async function deliverDue(env: Env): Promise<{ sent: number; gone: number }> {
  let sent = 0;
  let gone = 0;
  let cursor: string | undefined;

  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor, limit: 100 });
    cursor = page.list_complete ? undefined : page.cursor;

    for (const key of page.keys) {
      const raw = await env.SUBS.get(key.name);
      if (!raw) continue;
      let record: SubRecord;
      try {
        record = JSON.parse(raw) as SubRecord;
      } catch {
        continue;
      }
      if (!record.enabled || !record.pool?.length) continue;
      if (Date.now() < (record.nextAt || 0)) continue;

      const idx = Math.floor(Math.random() * record.pool.length);
      const payload = record.pool[idx];
      try {
        const status = await sendPush(env, record.subscription, payload);
        if (status === 404 || status === 410) {
          await env.SUBS.delete(key.name);
          gone += 1;
          continue;
        }
        if (status >= 200 && status < 300) {
          sent += 1;
          record.nextAt =
            Date.now() + randomGapMs(record.intervalMinutes || 60);
          record.updatedAt = Date.now();
          await env.SUBS.put(key.name, JSON.stringify(record));
        }
      } catch {
        // skip this sub this tick
      }
    }
  } while (cursor);

  return { sent, gone };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/vapid-public-key') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY }, {}, origin, env);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true }, {}, origin, env);
    }

    if (request.method === 'POST' && url.pathname === '/subscribe') {
      const body = (await request.json()) as {
        subscription?: SubRecord['subscription'];
        intervalMinutes?: number;
        pool?: PushPayload[];
        enabled?: boolean;
      };

      if (!body.subscription?.endpoint || !body.subscription.keys?.p256dh) {
        return json({ error: 'invalid subscription' }, { status: 400 }, origin, env);
      }

      const intervalMinutes =
        typeof body.intervalMinutes === 'number' && body.intervalMinutes > 0
          ? body.intervalMinutes
          : 60;
      const pool = Array.isArray(body.pool) ? body.pool.slice(0, 120) : [];
      const enabled = body.enabled !== false;

      const existingRaw = await env.SUBS.get(subKey(body.subscription.endpoint));
      let nextAt = Date.now() + randomGapMs(intervalMinutes);
      if (existingRaw) {
        try {
          const prev = JSON.parse(existingRaw) as SubRecord;
          if (prev.nextAt && prev.nextAt > Date.now()) nextAt = prev.nextAt;
        } catch {
          // ignore
        }
      }

      const record: SubRecord = {
        subscription: body.subscription,
        intervalMinutes,
        nextAt,
        pool,
        enabled,
        updatedAt: Date.now(),
      };

      await env.SUBS.put(subKey(body.subscription.endpoint), JSON.stringify(record));
      return json(
        { ok: true, nextAt, poolSize: pool.length },
        {},
        origin,
        env,
      );
    }

    if (request.method === 'POST' && url.pathname === '/unsubscribe') {
      const body = (await request.json()) as { endpoint?: string };
      if (!body.endpoint) {
        return json({ error: 'missing endpoint' }, { status: 400 }, origin, env);
      }
      await env.SUBS.delete(subKey(body.endpoint));
      return json({ ok: true }, {}, origin, env);
    }

    if (request.method === 'POST' && url.pathname === '/test') {
      const body = (await request.json()) as { endpoint?: string };
      if (!body.endpoint) {
        return json({ error: 'missing endpoint' }, { status: 400 }, origin, env);
      }
      const raw = await env.SUBS.get(subKey(body.endpoint));
      if (!raw) {
        return json({ error: 'not subscribed' }, { status: 404 }, origin, env);
      }
      const record = JSON.parse(raw) as SubRecord;
      if (!record.pool.length) {
        return json({ error: 'empty pool' }, { status: 400 }, origin, env);
      }
      const payload = record.pool[Math.floor(Math.random() * record.pool.length)];
      const status = await sendPush(env, record.subscription, payload);
      if (status === 404 || status === 410) {
        await env.SUBS.delete(subKey(body.endpoint));
        return json({ error: 'subscription gone', status }, { status: 410 }, origin, env);
      }
      return json({ ok: status >= 200 && status < 300, status }, {}, origin, env);
    }

    if (request.method === 'POST' && url.pathname === '/tick') {
      // Manual cron for debugging
      const result = await deliverDue(env);
      return json(result, {}, origin, env);
    }

    return json({ error: 'not found' }, { status: 404 }, origin, env);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(deliverDue(env));
  },
};
