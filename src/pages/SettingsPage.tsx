import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getActiveTerms, getTermById } from '../data/terms';
import {
  ensureNotificationPermission,
  getIntervalMinutes,
  getLastPushSync,
  getNotificationsEnabled,
  getPushApiUrl,
  getScheduleInfo,
  isPushConfigured,
  rescheduleAll,
  sendTestNotification,
  setIntervalMinutes,
  setNotificationsEnabled,
  setPushApiUrl,
} from '../notifications';
import {
  clearAllHidden,
  getCustomQuestionCount,
  getHiddenTermIds,
  unhideTerm,
} from '../userPrefs';

const INTERVALS = [
  { label: 'Τυχαία ~ κάθε 15 λεπτά', minutes: 15 },
  { label: 'Τυχαία ~ κάθε 1 ώρα', minutes: 60 },
  { label: 'Τυχαία ~ κάθε 2 ώρες', minutes: 120 },
  { label: 'Τυχαία ~ κάθε 4 ώρες', minutes: 240 },
  { label: 'Τυχαία ~ κάθε 8 ώρες', minutes: 480 },
];

function formatNext(ts: number | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('el-GR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function SettingsPage() {
  const [enabled, setEnabled] = useState(getNotificationsEnabled);
  const [minutes, setMinutes] = useState(getIntervalMinutes);
  const [status, setStatus] = useState('');
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getScheduleInfo>>>({
    remaining: 0,
    nextAt: null,
    triggers: false,
    swPath: false,
    pushConfigured: isPushConfigured(),
    pushOk: false,
    pushError: null,
  });
  const [hiddenIds, setHiddenIds] = useState(getHiddenTermIds);
  const [pushUrlDraft, setPushUrlDraft] = useState(
    () => getPushApiUrl() ?? '',
  );
  const activeCount = getActiveTerms().length;

  const refreshInfo = useCallback(async () => {
    setInfo(await getScheduleInfo());
    setHiddenIds(getHiddenTermIds());
  }, []);

  useEffect(() => {
    void refreshInfo();
    const id = window.setInterval(() => void refreshInfo(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshInfo]);

  const onToggle = async () => {
    const next = !enabled;
    if (next) {
      if (!isPushConfigured()) {
        setStatus(
          'Βάλε πρώτα το Push server URL παρακάτω (πρέπει να είναι https://…).',
        );
        return;
      }
      const ok = await ensureNotificationPermission();
      if (!ok) {
        setStatus(
          'Δεν δόθηκε άδεια ειδοποιήσεων. Έλεγξε τις ρυθμίσεις του browser / της PWA.',
        );
        return;
      }
      setEnabled(true);
      const n = await rescheduleAll();
      setStatus(
        n > 0
          ? `Ενεργό — συγχρονίστηκαν ${n} ερωτήσεις στον push server.`
          : 'Απέτυχε ο συγχρονισμός με τον push server. Δες τις λεπτομέρειες παρακάτω.',
      );
    } else {
      setEnabled(false);
      setNotificationsEnabled(false);
      setStatus('Οι ειδοποιήσεις απενεργοποιήθηκαν.');
    }
    await refreshInfo();
  };

  const onInterval = async (m: number) => {
    setMinutes(m);
    setIntervalMinutes(m);
    if (enabled) {
      const n = await rescheduleAll();
      setStatus(
        `Νέο διάστημα ~${m < 60 ? `${m} λεπτά` : `${m / 60} ώρ.`} — sync ${n} ερωτήσεων.`,
      );
    } else {
      setStatus(
        `Διάστημα: τυχαία γύρω από ${m < 60 ? `${m} λεπτά` : `${m / 60} ώρ`}.`,
      );
    }
    await refreshInfo();
  };

  const onTest = async () => {
    const ok = await sendTestNotification();
    setStatus(
      ok
        ? 'Στάλθηκε δοκιμαστική (τοπική + push αν είναι ρυθμισμένο). Πάτα την ειδοποίηση — πρέπει να ανοίξει η εφαρμογή.'
        : 'Απέτυχε — επίτρεψε ειδοποιήσεις στον browser.',
    );
    await refreshInfo();
  };

  const onSavePushUrl = () => {
    setPushApiUrl(pushUrlDraft);
    const saved = getPushApiUrl();
    setPushUrlDraft(saved ?? '');
    if (!saved) {
      setStatus('Καθάρισες το Push URL.');
    } else if (saved.startsWith('http://')) {
      setStatus(
        'Αποθηκεύτηκε, αλλά από GitHub Pages χρειάζεται https:// — το http θα μπλοκαριστεί.',
      );
    } else {
      setStatus(`Push URL: ${saved}`);
    }
    void refreshInfo();
  };

  const onReschedule = async () => {
    if (!isPushConfigured()) {
      setStatus('Λείπει Push server URL — συμπλήρωσέ το παρακάτω.');
      return;
    }
    const ok = await ensureNotificationPermission();
    if (!ok) {
      setStatus('Δεν δόθηκε άδεια ειδοποιήσεων.');
      return;
    }
    setEnabled(true);
    const n = await rescheduleAll();
    const syncInfo = getLastPushSync();
    setStatus(
      n > 0
        ? `Συγχρονίστηκαν ${n} ερωτήσεις. Θα πρέπει να έρθει μία ειδοποίηση τώρα· μετά ~κάθε ${minutes < 60 ? `${minutes} λεπτά` : `${minutes / 60} ώρ.`}.${
            syncInfo?.error ? ` (push: ${syncInfo.error})` : ''
          }`
        : 'Αποτυχία sync — δες Push status παρακάτω.',
    );
    await refreshInfo();
  };

  const sync = getLastPushSync();
  const perm =
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const pushUrl = getPushApiUrl();

  return (
    <div className="app-shell">
      <Link className="linkish" to="/">
        ‹ Αρχική
      </Link>

      <h1 className="brand" style={{ fontSize: '2.5rem', marginTop: '1rem' }}>
        Ειδοποιήσεις
      </h1>
      <p className="subtitle">
        Web Push από server — δουλεύουν με κλειστή PWA στο Android Chrome (
        {activeCount} ενεργοί όροι).
      </p>

      <div className="panel">
        <label className="meaning-label" htmlFor="push-url">
          Push server URL
        </label>
        <input
          id="push-url"
          className="search-input"
          style={{ marginTop: '0.35rem' }}
          type="url"
          placeholder="https://sailing-push.onrender.com"
          value={pushUrlDraft}
          onChange={(e) => setPushUrlDraft(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: '0.65rem' }}
          onClick={onSavePushUrl}
        >
          Αποθήκευση URL
        </button>
        <p style={{ margin: '0.65rem 0 0', opacity: 0.65, fontSize: '0.8rem' }}>
          Προεπιλογή: sailing-push.onrender.com. Πάτα «Συγχρόνισε ξανά» — πρέπει
          να έρθει άμεσα μία ειδοποίηση. Το GitHub Action ξυπνά τον server κάθε
          5′.
        </p>
      </div>

      <div className="panel row">
        <span>Τυχαίες ειδοποιήσεις</span>
        <button
          type="button"
          className={`switch ${enabled ? 'on' : ''}`}
          aria-pressed={enabled}
          onClick={() => void onToggle()}
        >
          <span />
        </button>
      </div>

      <div className="panel" style={{ marginTop: 0 }}>
        <p style={{ margin: '0 0 0.35rem', opacity: 0.85, fontSize: '0.9rem' }}>
          Pool στον server: <strong>{info.remaining}</strong>
        </p>
        <p style={{ margin: 0, opacity: 0.85, fontSize: '0.9rem' }}>
          Επόμενη περίπου: <strong>{formatNext(info.nextAt)}</strong>
        </p>
        <p style={{ margin: '0.5rem 0 0', opacity: 0.65, fontSize: '0.8rem' }}>
          Άδεια: <strong>{perm}</strong> · SW:{' '}
          <strong>{info.swPath ? 'ναι' : 'όχι'}</strong> · Push API:{' '}
          <strong>{info.pushConfigured ? 'ναι' : 'όχι'}</strong> · Sync:{' '}
          <strong>{info.pushOk ? 'OK' : 'όχι'}</strong>
          {info.pushError ? ` (${info.pushError})` : ''}
        </p>
        {pushUrl && (
          <p style={{ margin: '0.35rem 0 0', opacity: 0.55, fontSize: '0.75rem' }}>
            {pushUrl}
          </p>
        )}
        {sync?.at && (
          <p style={{ margin: '0.35rem 0 0', opacity: 0.55, fontSize: '0.75rem' }}>
            Τελευταίο sync: {new Date(sync.at).toLocaleString('el-GR')}
          </p>
        )}
      </div>

      <h2 className="section-title" style={{ marginTop: '0.5rem' }}>
        Μέσο διάστημα
      </h2>
      {INTERVALS.map((item) => (
        <button
          key={item.minutes}
          type="button"
          className={`interval ${minutes === item.minutes ? 'active' : ''}`}
          onClick={() => void onInterval(item.minutes)}
        >
          {item.label}
        </button>
      ))}

      <div className="stack" style={{ marginTop: '1.2rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onReschedule()}
        >
          <span className="label">Συγχρόνισε ξανά με τον server</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onTest()}
        >
          Δοκιμαστική ειδοποίηση τώρα
        </button>
      </div>

      {status && <p className="status">{status}</p>}

      <h2 className="section-title" style={{ marginTop: '1.5rem' }}>
        Ερωτήσεις & όροι
      </h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Σε κάθε κάρτα quiz: «Επεξεργασία ερώτησης» ή «Απόκρυψη». Προσαρμοσμένες:{' '}
        {getCustomQuestionCount()}.
      </p>

      {hiddenIds.length > 0 ? (
        <div className="panel">
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
            Κρυμμένοι όροι ({hiddenIds.length}):
          </p>
          <ul className="hidden-list">
            {hiddenIds.map((id) => {
              const t = getTermById(id);
              return (
                <li key={id}>
                  <span>{t ? `${t.el} (${t.en})` : id}</span>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      unhideTerm(id);
                      setHiddenIds(getHiddenTermIds());
                      setStatus('Ο όρος επανήλθε στο quiz.');
                    }}
                  >
                    Επαναφορά
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: '0.75rem' }}
            onClick={() => {
              const n = clearAllHidden();
              setHiddenIds([]);
              setStatus(n > 0 ? `Επανήλθαν ${n} όροι.` : 'Δεν υπήρχαν κρυμμένοι.');
            }}
          >
            Επαναφορά όλων των κρυμμένων
          </button>
        </div>
      ) : (
        <p className="sources">Δεν έχεις κρύψει όρους.</p>
      )}

      <p className="sources">
        Οι τοπικές «προγραμματισμένες» ειδοποιήσεις (TimestampTrigger) δεν
        δουλεύουν σε κανονικό Chrome/Android — γι&apos; αυτό χρησιμοποιούμε Web
        Push από server. Πάτα την ειδοποίηση για να ανοίξει η σωστή ερώτηση.
        <br />
        <br />
        Πηγές ορολογίας: PASIDI.GR, IonianSkipper, Halkidiki Sailing.
      </p>
    </div>
  );
}
