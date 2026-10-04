import { buildQuizQuestion, getRandomTerm, TERMS } from './data/terms';

const KEY_ENABLED = 'sailing.notifications.enabled';
const KEY_INTERVAL = 'sailing.notifications.intervalMinutes';
const KEY_QUEUE = 'sailing.notifications.queue';

/** Πόσες μελλοντικές ειδοποιήσεις κρατάμε προγραμματισμένες */
const BATCH_SIZE = 36;
const POLL_MS = 30_000;

type QueueItem = { at: number; termId: string; tag: string };

let pollTimer: ReturnType<typeof setInterval> | null = null;
let scheduling = false;

export function getNotificationsEnabled(): boolean {
  return localStorage.getItem(KEY_ENABLED) !== 'false';
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(KEY_ENABLED, enabled ? 'true' : 'false');
  if (enabled) {
    void rescheduleAll();
  } else {
    void clearAllScheduled();
    stopPolling();
  }
}

/** Προεπιλογή: κάθε 60 λεπτά (με τυχαίο jitter). */
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

export function supportsScheduledTriggers(): boolean {
  return typeof (globalThis as { TimestampTrigger?: unknown }).TimestampTrigger === 'function';
}

function appPath(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, '')}`;
}

function openNotificationUrl(url: string) {
  const absolute = url.startsWith('http')
    ? url
    : `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
  window.focus();
  window.location.assign(absolute);
}

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(KEY_QUEUE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueItem[]): void {
  localStorage.setItem(KEY_QUEUE, JSON.stringify(queue));
}

/** Τυχαίο διάστημα ~40%–160% του επιλεγμένου μέσου όρου */
function randomGapMs(intervalMinutes: number): number {
  const base = intervalMinutes * 60 * 1000;
  const min = Math.max(45_000, Math.floor(base * 0.4));
  const max = Math.max(min + 15_000, Math.floor(base * 1.6));
  return min + Math.floor(Math.random() * (max - min));
}

function buildQueue(from = Date.now()): QueueItem[] {
  const interval = getIntervalMinutes();
  const items: QueueItem[] = [];
  let t = from;
  for (let i = 0; i < BATCH_SIZE; i++) {
    t += randomGapMs(interval);
    const term = getRandomTerm();
    items.push({
      at: t,
      termId: term.id,
      tag: `sailing-${t}-${term.id}-${i}`,
    });
  }
  return items;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

async function clearTriggeredNotifications(): Promise<void> {
  const reg = await getRegistration();
  if (!reg) return;
  try {
    const existing = await reg.getNotifications({
      // @ts-expect-error — Chromium includeTriggered
      includeTriggered: true,
    });
    for (const n of existing) {
      if (n.tag?.startsWith('sailing-')) n.close();
    }
  } catch {
    const existing = await reg.getNotifications();
    for (const n of existing) {
      if (n.tag?.startsWith('sailing-')) n.close();
    }
  }
}

async function clearAllScheduled(): Promise<void> {
  saveQueue([]);
  await clearTriggeredNotifications();
}

async function showTermNotification(
  termId?: string,
  tag = `sailing-now-${Date.now()}`,
): Promise<void> {
  const term = termId
    ? (TERMS.find((t) => t.id === termId) ?? getRandomTerm())
    : getRandomTerm();

  const question = buildQuizQuestion(term);
  const title = '⛵ Ορολογία ιστιοπλοΐας';
  const body = question.replace(/\n+/g, ' ');
  const url = appPath(`term/${term.id}?mode=quiz&category=all&reveal=1`);
  const icon = appPath('icons/icon-192.svg');

  const reg = await getRegistration();
  if (reg) {
    await reg.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag,
      data: { url, termId: term.id },
    });
    return;
  }

  const n = new Notification(title, {
    body,
    icon,
    tag,
    data: { url, termId: term.id },
  });
  n.onclick = () => {
    openNotificationUrl(url);
    n.close();
  };
}

async function scheduleTriggered(item: QueueItem): Promise<boolean> {
  const TimestampTrigger = (
    globalThis as {
      TimestampTrigger?: new (ts: number) => unknown;
    }
  ).TimestampTrigger;

  if (!TimestampTrigger) return false;

  const term = TERMS.find((t) => t.id === item.termId) ?? getRandomTerm();
  const question = buildQuizQuestion(term);
  const title = '⛵ Ορολογία ιστιοπλοΐας';
  const body = question.replace(/\n+/g, ' ');
  const url = appPath(`term/${term.id}?mode=quiz&category=all&reveal=1`);
  const icon = appPath('icons/icon-192.svg');
  const reg = await getRegistration();
  if (!reg) return false;

  try {
    await reg.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag: item.tag,
      data: { url, termId: term.id },
      // @ts-expect-error — Notification Triggers (Chromium)
      showTrigger: new TimestampTrigger(item.at),
    });
    return true;
  } catch {
    return false;
  }
}

/** Δείξε όσες ειδοποιήσεις έχουν «ληξιπρόθεσμο» χρόνο (fallback χωρίς Triggers). */
async function flushDueFromQueue(): Promise<void> {
  if (!getNotificationsEnabled()) return;
  if (Notification.permission !== 'granted') return;

  const now = Date.now();
  let queue = loadQueue();
  const due = queue.filter((q) => q.at <= now);
  if (due.length === 0) return;

  queue = queue.filter((q) => q.at > now);
  saveQueue(queue);

  // Το πολύ μία ανά poll για να μην σκάσει σμήνος αν καθυστέρησε πολύ
  const item = due[due.length - 1];
  await showTermNotification(item.termId, item.tag);

  if (queue.length < 8) {
    void topUpQueue();
  }
}

async function topUpQueue(): Promise<void> {
  if (scheduling) return;
  scheduling = true;
  try {
    let queue = loadQueue().filter((q) => q.at > Date.now());
    if (queue.length >= BATCH_SIZE) {
      saveQueue(queue);
      return;
    }

    const from = queue.length ? queue[queue.length - 1].at : Date.now();
    const extra = buildQueue(from).slice(0, BATCH_SIZE - queue.length);
    queue = [...queue, ...extra];
    saveQueue(queue);

    if (supportsScheduledTriggers()) {
      for (const item of extra) {
        await scheduleTriggered(item);
      }
    }
  } finally {
    scheduling = false;
  }
}

export async function rescheduleAll(): Promise<number> {
  const ok = await ensureNotificationPermission();
  if (!ok) return 0;

  localStorage.setItem(KEY_ENABLED, 'true');
  await clearTriggeredNotifications();

  const queue = buildQueue(Date.now());
  saveQueue(queue);

  let scheduled = 0;
  if (supportsScheduledTriggers()) {
    for (const item of queue) {
      if (await scheduleTriggered(item)) scheduled += 1;
    }
  } else {
    // Fallback: ουρά + polling όσο ζει η σελίδα/PWA
    scheduled = queue.length;
  }

  startPolling();
  return scheduled;
}

/** @deprecated alias — κρατά συμβατότητα με Settings */
export async function scheduleNextNotification(reset = false): Promise<void> {
  if (reset || loadQueue().length === 0) {
    await rescheduleAll();
  } else {
    startPolling();
    await flushDueFromQueue();
    await topUpQueue();
  }
}

export async function sendTestNotification(): Promise<boolean> {
  const ok = await ensureNotificationPermission();
  if (!ok) return false;
  await showTermNotification();
  // Μην χαλάσεις το πρόγραμμα — γέμισε αν χρειάζεται
  void topUpQueue();
  startPolling();
  return true;
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void flushDueFromQueue();
  }, POLL_MS);
  void flushDueFromQueue();
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
    startPolling();
    void flushDueFromQueue();
    void topUpQueue();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('focus', wake);

  if (getNotificationsEnabled() && Notification.permission === 'granted') {
    // Αν η ουρά είναι άδεια ή τελείωσε, ξαναγέμισέ την
    const queue = loadQueue().filter((q) => q.at > Date.now());
    if (queue.length < 4) {
      await rescheduleAll();
    } else {
      saveQueue(queue);
      startPolling();
      // Ξαναπέρασε Triggers αν υποστηρίζονται (σε περίπτωση update SW)
      if (supportsScheduledTriggers()) {
        await clearTriggeredNotifications();
        for (const item of queue) {
          await scheduleTriggered(item);
        }
      }
    }
  }
}

export function getScheduleInfo(): {
  remaining: number;
  nextAt: number | null;
  triggers: boolean;
} {
  const queue = loadQueue().filter((q) => q.at > Date.now());
  return {
    remaining: queue.length,
    nextAt: queue[0]?.at ?? null,
    triggers: supportsScheduledTriggers(),
  };
}
