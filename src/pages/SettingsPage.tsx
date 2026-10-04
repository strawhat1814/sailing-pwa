import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TERMS } from '../data/terms';
import {
  ensureNotificationPermission,
  getIntervalMinutes,
  getNotificationsEnabled,
  getScheduleInfo,
  rescheduleAll,
  sendTestNotification,
  setIntervalMinutes,
  setNotificationsEnabled,
  supportsScheduledTriggers,
} from '../notifications';

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
  const [info, setInfo] = useState(getScheduleInfo);

  const refreshInfo = () => setInfo(getScheduleInfo());

  useEffect(() => {
    refreshInfo();
    const id = window.setInterval(refreshInfo, 15_000);
    return () => window.clearInterval(id);
  }, []);

  const onToggle = async () => {
    const next = !enabled;
    if (next) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        setStatus(
          'Δεν δόθηκε άδεια ειδοποιήσεων. Έλεγξε τις ρυθμίσεις του browser.',
        );
        return;
      }
      setEnabled(true);
      const n = await rescheduleAll();
      setStatus(
        n > 0
          ? `Ενεργό — προγραμματίστηκαν ${n} τυχαίες ειδοποιήσεις.`
          : 'Ενεργό — ουρά ειδοποιήσεων έτοιμη.',
      );
    } else {
      setEnabled(false);
      setNotificationsEnabled(false);
      setStatus('Οι ειδοποιήσεις απενεργοποιήθηκαν.');
    }
    refreshInfo();
  };

  const onInterval = async (m: number) => {
    setMinutes(m);
    setIntervalMinutes(m);
    if (enabled) {
      const n = await rescheduleAll();
      setStatus(
        `Νέο διάστημα ~${m < 60 ? `${m} λεπτά` : `${m / 60} ώρ.`} — ${n} τυχαίες ειδοποιήσεις.`,
      );
    } else {
      setStatus(
        `Διάστημα: τυχαία γύρω από ${m < 60 ? `${m} λεπτά` : `${m / 60} ώρ`}.`,
      );
    }
    refreshInfo();
  };

  const onTest = async () => {
    const ok = await sendTestNotification();
    setStatus(
      ok
        ? 'Στάλθηκε δοκιμαστική ειδοποίηση (το πρόγραμμα συνεχίζει).'
        : 'Απέτυχε — επίτρεψε ειδοποιήσεις στον browser.',
    );
    refreshInfo();
  };

  const onReschedule = async () => {
    const ok = await ensureNotificationPermission();
    if (!ok) {
      setStatus('Δεν δόθηκε άδεια ειδοποιήσεων.');
      return;
    }
    setEnabled(true);
    const n = await rescheduleAll();
    setStatus(
      `Προγραμματίστηκαν ${n || 'πολλές'} τυχαίες ειδοποιήσεις σε τυχαίες ώρες.`,
    );
    refreshInfo();
  };

  return (
    <div className="app-shell">
      <Link className="linkish" to="/">
        ‹ Αρχική
      </Link>

      <h1 className="brand" style={{ fontSize: '2.5rem', marginTop: '1rem' }}>
        Ειδοποιήσεις
      </h1>
      <p className="subtitle">
        Τυχαίες ερωτήσεις σε τυχαίες ώρες (όχι ακριβώς κάθε Χ λεπτά). Με κλικ
        ανοίγει ο όρος ({TERMS.length} λέξεις).
      </p>

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
          Σε αναμονή: <strong>{info.remaining}</strong>
        </p>
        <p style={{ margin: 0, opacity: 0.85, fontSize: '0.9rem' }}>
          Επόμενη περίπου: <strong>{formatNext(info.nextAt)}</strong>
        </p>
        <p style={{ margin: '0.5rem 0 0', opacity: 0.65, fontSize: '0.8rem' }}>
          {supportsScheduledTriggers()
            ? 'Λειτουργία: προγραμματισμένες ειδοποιήσεις (δουλεύουν και με κλειστή εφαρμογή σε Chrome/Edge).'
            : 'Λειτουργία: ουρά + έλεγχος όσο η PWA/καρτέλα ζει. Σε Chrome/Edge εγκατεστημένη PWA δουλεύει καλύτερα.'}
        </p>
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
          <span className="label">Προγραμμάτισε ξανά</span>
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

      <p className="sources">
        Πάτα «Προγραμμάτισε ξανά» μετά την εγκατάσταση της PWA. Σε Chrome/Android
        προγραμματίζονται δεκάδες τυχαίες ειδοποιήσεις μπροστά. Το iOS έχει
        περισσότερους περιορισμούς.
        <br />
        <br />
        Πηγές ορολογίας: PASIDI.GR, IonianSkipper, Halkidiki Sailing.
      </p>
    </div>
  );
}
