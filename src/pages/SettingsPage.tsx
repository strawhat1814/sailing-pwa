import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TERMS } from '../data/terms';
import {
  ensureNotificationPermission,
  getIntervalMinutes,
  getNotificationsEnabled,
  scheduleNextNotification,
  sendTestNotification,
  setIntervalMinutes,
  setNotificationsEnabled,
} from '../notifications';

const INTERVALS = [
  { label: 'Κάθε 15 λεπτά (δοκιμή)', minutes: 15 },
  { label: 'Κάθε 1 ώρα', minutes: 60 },
  { label: 'Κάθε 2 ώρες', minutes: 120 },
  { label: 'Κάθε 4 ώρες', minutes: 240 },
  { label: 'Κάθε 8 ώρες', minutes: 480 },
];

export function SettingsPage() {
  const [enabled, setEnabled] = useState(getNotificationsEnabled);
  const [minutes, setMinutes] = useState(getIntervalMinutes);
  const [status, setStatus] = useState('');

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
    }
    setEnabled(next);
    setNotificationsEnabled(next);
    setStatus(
      next
        ? 'Οι ειδοποιήσεις ενεργοποιήθηκαν.'
        : 'Οι ειδοποιήσεις απενεργοποιήθηκαν.',
    );
  };

  const onInterval = (m: number) => {
    setMinutes(m);
    setIntervalMinutes(m);
    setStatus(`Διάστημα: κάθε ${m < 60 ? `${m} λεπτά` : `${m / 60} ώρ${m === 60 ? 'α' : 'ες'}`}.`);
  };

  const onTest = async () => {
    const ok = await sendTestNotification();
    setStatus(
      ok
        ? 'Στάλθηκε δοκιμαστική ειδοποίηση.'
        : 'Απέτυχε — επίτρεψε ειδοποιήσεις στον browser.',
    );
  };

  const onReschedule = async () => {
    const ok = await ensureNotificationPermission();
    if (!ok) {
      setStatus('Δεν δόθηκε άδεια ειδοποιήσεων.');
      return;
    }
    setEnabled(true);
    setNotificationsEnabled(true);
    await scheduleNextNotification(true);
    setStatus('Προγραμματίστηκε η επόμενη τυχαία ερώτηση.');
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
        Η PWA στέλνει τυχαίες ερωτήσεις ορολογίας. Με κλικ ανοίγει ο όρος με
        ελληνική εξήγηση ({TERMS.length} λέξεις).
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

      <h2 className="section-title" style={{ marginTop: '0.5rem' }}>
        Συχνότητα
      </h2>
      {INTERVALS.map((item) => (
        <button
          key={item.minutes}
          type="button"
          className={`interval ${minutes === item.minutes ? 'active' : ''}`}
          onClick={() => onInterval(item.minutes)}
        >
          {item.label}
        </button>
      ))}

      <div className="stack" style={{ marginTop: '1.2rem' }}>
        <button type="button" className="btn btn-primary" onClick={() => void onReschedule()}>
          <span className="label">Προγραμμάτισε ξανά</span>
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void onTest()}>
          Δοκιμαστική ειδοποίηση τώρα
        </button>
      </div>

      {status && <p className="status">{status}</p>}

      <p className="sources">
        Σημείωση: Στο web οι ειδοποιήσεις δουλεύουν καλύτερα όταν η PWA είναι
        εγκατεστημένη (Add to Home Screen) και ο browser είναι ανοιχτός στο
        παρασκήνιο. Το iOS Safari έχει περιορισμούς — εγκατάσταση στην αρχική
        οθόνη βοηθάει.
        <br />
        <br />
        Πηγές ορολογίας: PASIDI.GR, IonianSkipper, Halkidiki Sailing.
      </p>
    </div>
  );
}
