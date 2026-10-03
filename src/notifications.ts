import { buildQuizQuestion, getRandomTerm, TERMS } from './data/terms';

const KEY_ENABLED = 'sailing.notifications.enabled';
const KEY_INTERVAL = 'sailing.notifications.intervalMinutes';
const KEY_NEXT_AT = 'sailing.notifications.nextAt';

let timer: ReturnType<typeof setTimeout> | null = null;

export function getNotificationsEnabled(): boolean {
  return localStorage.getItem(KEY_ENABLED) !== 'false';
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(KEY_ENABLED, enabled ? 'true' : 'false');
  if (enabled) {
    void scheduleNextNotification(true);
  } else if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Προεπιλογή: κάθε 120 λεπτά (2 ώρες). Στο web χρησιμοποιούμε λεπτά για ευελιξία. */
export function getIntervalMinutes(): number {
  const raw = localStorage.getItem(KEY_INTERVAL);
  const n = raw ? Number(raw) : 120;
  return Number.isFinite(n) && n > 0 ? n : 120;
}

export function setIntervalMinutes(minutes: number): void {
  localStorage.setItem(KEY_INTERVAL, String(minutes));
  if (getNotificationsEnabled()) void scheduleNextNotification(true);
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function appPath(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, '')}`;
}

function openTermFromNotification(termId: string) {
  const url = `${window.location.origin}${appPath(`term/${termId}?mode=browse`)}`;
  window.focus();
  window.location.assign(url);
}

async function showTermNotification(termId?: string): Promise<void> {
  const term = termId
    ? TERMS.find((t) => t.id === termId) ?? getRandomTerm()
    : getRandomTerm();

  const title = '⛵ Ορολογία ιστιοπλοΐας';
  const body = buildQuizQuestion(term).text.replace(/\n+/g, ' ');
  const url = appPath(`term/${term.id}?mode=quiz&category=all`);

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    const icon = appPath('icons/icon-192.svg');
    await reg.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag: 'sailing-term',
      data: { url, termId: term.id },
    });
    return;
  }

  const n = new Notification(title, {
    body,
    icon: appPath('icons/icon-192.svg'),
    tag: 'sailing-term',
    data: { url, termId: term.id },
  });
  n.onclick = () => {
    openTermFromNotification(term.id);
    n.close();
  };
}

export async function sendTestNotification(): Promise<boolean> {
  const ok = await ensureNotificationPermission();
  if (!ok) return false;
  await showTermNotification();
  return true;
}

export async function scheduleNextNotification(reset = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (!getNotificationsEnabled()) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const minutes = getIntervalMinutes();
  const jitterMs = Math.floor(Math.random() * 10 * 60 * 1000) - 5 * 60 * 1000;
  let nextAt = Number(localStorage.getItem(KEY_NEXT_AT) || 0);
  const now = Date.now();

  if (reset || !nextAt || nextAt < now) {
    nextAt = now + minutes * 60 * 1000 + jitterMs;
    localStorage.setItem(KEY_NEXT_AT, String(nextAt));
  }

  const delay = Math.max(5_000, nextAt - now);

  timer = setTimeout(async () => {
    await showTermNotification();
    localStorage.setItem(
      KEY_NEXT_AT,
      String(Date.now() + getIntervalMinutes() * 60 * 1000),
    );
    void scheduleNextNotification(false);
  }, delay);
}

export async function initNotificationScheduler(): Promise<void> {
  if (!('Notification' in window)) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'NOTIFICATION_CLICK' && data.url) {
        window.location.assign(data.url);
      }
    });
  }

  // Ξαναπρογραμμάτισε όταν επιστρέφει ο χρήστης στην καρτέλα
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getNotificationsEnabled()) {
      void scheduleNextNotification(false);
    }
  });

  if (getNotificationsEnabled() && Notification.permission === 'granted') {
    await scheduleNextNotification(false);
  }
}
