import { buildQuizQuestion, getRandomTerm, getTermById } from './data/terms';
import { getQuizChoices } from './quizChoices';

const KEY_ENABLED = 'sailing.notifications.enabled';
const KEY_INTERVAL = 'sailing.notifications.intervalMinutes';
const KEY_LAST_SYNC = 'sailing.notifications.lastPushSync';
const KEY_ENDPOINT = 'sailing.notifications.pushEndpoint';
const KEY_PUSH_URL = 'sailing.notifications.pushApiUrl';

const POOL_SIZE = 80;

const ENV_PUSH_API_URL = (
  import.meta.env.VITE_PUSH_API_URL as string | undefined
)?.replace(/\/$/, '');
const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BKPjkYH16YAQmBxARvV_IjRTsAhHRMSbLA8zcPY1--ULq8H-m9e7DJ1ZX7VyZFF7IrVlQuBEOlYmEjsA-2fg220';

function normalizePushUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '');
}

/** Runtime URL (Settings) wins over build-time VITE_PUSH_API_URL. */
export function getPushApiUrl(): string | null {
  try {
    const saved = localStorage.getItem(KEY_PUSH_URL);
    if (saved?.trim()) return normalizePushUrl(saved);
  } catch {
    // ignore
  }
  return ENV_PUSH_API_URL || null;
}

export function setPushApiUrl(url: string): void {
  const cleaned = normalizePushUrl(url);
  if (!cleaned) {
    localStorage.removeItem(KEY_PUSH_URL);
    return;
  }
  localStorage.setItem(KEY_PUSH_URL, cleaned);
}

export function isPushConfigured(): boolean {
  return Boolean(getPushApiUrl() && VAPID_PUBLIC_KEY);
}

export function getNotificationsEnabled(): boolean {
  return localStorage.getItem(KEY_ENABLED) !== 'false';
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(KEY_ENABLED, enabled ? 'true' : 'false');
  if (enabled) {
    void rescheduleAll();
  } else {
    void unsubscribePush();
  }
}

export function getIntervalMinutes(): number {
  const raw = localStorage.getItem(KEY_INTERVAL);
  const n = raw ? Number(raw) : 60;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function setIntervalMinutes(minutes: number): void {
  localStorage.setItem(KEY_INTERVAL, String(minutes));
  if (getNotificationsEnabled()) void rescheduleAll();
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** TimestampTrigger δεν είναι production στο Chrome — κρατάμε detection μόνο για info */
export function supportsScheduledTriggers(): boolean {
  return (
    typeof (globalThis as { TimestampTrigger?: unknown }).TimestampTrigger ===
      'function' && 'showTrigger' in Notification.prototype
  );
}

function appPath(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, '')}`;
}

/** Relative to SW scope — open MC quiz (not revealed). */
function termQuizPath(termId: string, pick?: string): string {
  let path = `term/${termId}?mode=quiz&category=all`;
  if (pick) path += `&pick=${encodeURIComponent(pick)}`;
  return path;
}

function openNotificationUrl(url: string) {
  const absolute = url.startsWith('http')
    ? url
    : new URL(url.replace(/^\//, ''), window.location.origin + appPath(''))
        .href;
  window.focus();
  window.location.assign(absolute);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

type PoolItem = {
  termId: string;
  title: string;
  body: string;
  url: string;
  tag?: string;
  answer?: string;
  choices?: string[];
};

function buildPool(): PoolItem[] {
  const items: PoolItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < POOL_SIZE * 3 && items.length < POOL_SIZE; i++) {
    const term = getRandomTerm();
    if (seen.has(term.id)) continue;
    seen.add(term.id);
    const question = buildQuizQuestion(term);
    const mc = getQuizChoices(term);
    const choices = mc?.options;
    const answer = mc?.answer;
    const bodyLines = [question.replace(/\n+/g, ' ')];
    if (choices?.length) {
      bodyLines.push('');
      choices.forEach((c, idx) => {
        bodyLines.push(`${idx + 1}) ${c}`);
      });
      bodyLines.push('', 'Πάτα 1–4 στην ειδοποίηση ή άνοιξε για όλες τις επιλογές.');
    }
    items.push({
      termId: term.id,
      title: '⛵ Ορολογία ιστιοπλοΐας',
      body: bodyLines.join('\n'),
      url: termQuizPath(term.id),
      tag: `sailing-${term.id}`,
      answer,
      choices,
    });
  }
  return items;
}

function saveLastSync(info: {
  ok: boolean;
  nextAt?: number;
  poolSize?: number;
  error?: string;
}): void {
  localStorage.setItem(
    KEY_LAST_SYNC,
    JSON.stringify({ ...info, at: Date.now() }),
  );
}

// keep type happy for callers that read error after ok sync

export function getLastPushSync(): {
  ok: boolean;
  nextAt?: number;
  poolSize?: number;
  error?: string;
  at: number;
} | null {
  try {
    const raw = localStorage.getItem(KEY_LAST_SYNC);
    if (!raw) return null;
    return JSON.parse(raw) as {
      ok: boolean;
      nextAt?: number;
      poolSize?: number;
      error?: string;
      at: number;
    };
  } catch {
    return null;
  }
}

async function ensurePushSubscription(): Promise<PushSubscription | null> {
  if (!isPushConfigured()) return null;
  if (!('PushManager' in window)) return null;

  const reg = await getRegistration();
  if (!reg) return null;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  localStorage.setItem(KEY_ENDPOINT, sub.endpoint);
  return sub;
}

async function syncToPushServer(
  sub: PushSubscription,
  enabled: boolean,
): Promise<{ ok: boolean; nextAt?: number; poolSize?: number; error?: string }> {
  const pushApiUrl = getPushApiUrl();
  if (!pushApiUrl) {
    return { ok: false, error: 'no push api url' };
  }

  try {
    const res = await fetch(`${pushApiUrl}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        intervalMinutes: getIntervalMinutes(),
        pool: buildPool(),
        enabled,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      nextAt?: number;
      poolSize?: number;
      error?: string;
      immediate?: { ok?: boolean; status?: number; error?: string };
    };
    if (!res.ok) {
      const err = data.error || `HTTP ${res.status}`;
      saveLastSync({ ok: false, error: err });
      return { ok: false, error: err };
    }
    const immediateOk = data.immediate?.ok;
    const immediateErr = data.immediate?.error
      || (data.immediate && data.immediate.ok === false
        ? `push status ${data.immediate.status ?? '?'}`
        : undefined);
    saveLastSync({
      ok: true,
      nextAt: data.nextAt,
      poolSize: data.poolSize,
      error: immediateOk === false ? immediateErr : undefined,
    });
    return {
      ok: true,
      nextAt: data.nextAt,
      poolSize: data.poolSize,
      error: immediateOk === false ? immediateErr : undefined,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'network error';
    saveLastSync({ ok: false, error });
    return { ok: false, error };
  }
}

async function unsubscribePush(): Promise<void> {
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  const endpoint =
    sub?.endpoint || localStorage.getItem(KEY_ENDPOINT) || undefined;
  const pushApiUrl = getPushApiUrl();

  if (pushApiUrl && endpoint) {
    try {
      await fetch(`${pushApiUrl}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    } catch {
      // ignore
    }
  }

  try {
    await sub?.unsubscribe();
  } catch {
    // ignore
  }
  localStorage.removeItem(KEY_ENDPOINT);
  saveLastSync({ ok: false, error: 'disabled' });
}

async function showLocalTermNotification(termId?: string): Promise<void> {
  const term = termId
    ? (getTermById(termId) ?? getRandomTerm())
    : getRandomTerm();
  const question = buildQuizQuestion(term);
  const mc = getQuizChoices(term);
  const choices = mc?.options;
  const answer = mc?.answer;
  const title = '⛵ Ορολογία ιστιοπλοΐας';
  const bodyLines = [question.replace(/\n+/g, ' ')];
  if (choices?.length) {
    bodyLines.push('');
    choices.forEach((c, idx) => bodyLines.push(`${idx + 1}) ${c}`));
    bodyLines.push('', 'Πάτα 1–4 ή άνοιξε την εφαρμογή.');
  }
  const body = bodyLines.join('\n');
  const urlPath = termQuizPath(term.id);
  const icon = new URL(appPath('icons/icon-192.svg'), window.location.origin)
    .href;
  const tag = `sailing-now-${Date.now()}`;
  const actions = (choices || []).slice(0, 4).map((_c, idx) => ({
    action: `choice:${idx}`,
    title: `${idx + 1}`,
  }));

  const reg = await getRegistration();
  if (reg) {
    await reg.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag,
      // @ts-expect-error actions supported in Chromium
      actions,
      data: {
        url: urlPath,
        termId: term.id,
        answer,
        choices,
      },
    });
    return;
  }

  const n = new Notification(title, {
    body,
    icon,
    tag,
    data: { url: urlPath, termId: term.id, answer, choices },
  });
  n.onclick = () => {
    openNotificationUrl(urlPath);
    n.close();
  };
}

export async function rescheduleAll(): Promise<number> {
  const ok = await ensureNotificationPermission();
  if (!ok) return 0;

  localStorage.setItem(KEY_ENABLED, 'true');

  if (!isPushConfigured()) {
    saveLastSync({
      ok: false,
      error: 'Push server URL not set',
    });
    return 0;
  }

  const sub = await ensurePushSubscription();
  if (!sub) {
    saveLastSync({ ok: false, error: 'PushManager subscribe failed' });
    return 0;
  }

  const result = await syncToPushServer(sub, true);
  return result.ok ? result.poolSize || POOL_SIZE : 0;
}

export async function scheduleNextNotification(reset = false): Promise<void> {
  if (reset || getNotificationsEnabled()) {
    await rescheduleAll();
  }
}

export async function sendTestNotification(): Promise<boolean> {
  const ok = await ensureNotificationPermission();
  if (!ok) return false;

  // Always show one local notification so click-to-open can be verified offline
  await showLocalTermNotification();

  if (!isPushConfigured()) return true;

  const sub = await ensurePushSubscription();
  if (!sub) return true;

  // Ensure server has a pool, then ask it to push one (tests end-to-end Web Push)
  await syncToPushServer(sub, true);
  const pushApiUrl = getPushApiUrl();
  try {
    if (pushApiUrl) {
      await fetch(`${pushApiUrl}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    }
  } catch {
    // local already shown
  }
  return true;
}

export async function initNotificationScheduler(): Promise<void> {
  if (!('Notification' in window)) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'NOTIFICATION_CLICK' && data.url) {
        openNotificationUrl(data.url);
      }
    });
  }

  const wake = () => {
    if (!getNotificationsEnabled()) return;
    if (Notification.permission !== 'granted') return;
    void rescheduleAll();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('focus', wake);

  if (getNotificationsEnabled() && Notification.permission === 'granted') {
    await rescheduleAll();
  }
}

export async function getScheduleInfo(): Promise<{
  remaining: number;
  nextAt: number | null;
  triggers: boolean;
  swPath: boolean;
  pushConfigured: boolean;
  pushOk: boolean;
  pushError: string | null;
}> {
  const sync = getLastPushSync();
  const reg = await getRegistration();
  return {
    remaining: sync?.poolSize ?? 0,
    nextAt: sync?.nextAt ?? null,
    triggers: supportsScheduledTriggers(),
    swPath: Boolean(reg?.active ?? navigator.serviceWorker?.controller),
    pushConfigured: isPushConfigured(),
    pushOk: Boolean(sync?.ok),
    pushError: sync?.error ?? null,
  };
}

/** @deprecated — kept for Settings that still call getLastApplyInfo */
export function getLastApplyInfo(): {
  scheduled: number;
  triggers: boolean;
  at: number;
} | null {
  const sync = getLastPushSync();
  if (!sync) return null;
  return {
    scheduled: sync.poolSize ?? 0,
    triggers: false,
    at: sync.at,
  };
}
