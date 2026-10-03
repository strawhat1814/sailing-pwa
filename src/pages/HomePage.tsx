import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CATEGORIES, Category, TERMS, getRandomTerm } from '../data/terms';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function HomePage() {
  const navigate = useNavigate();
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  const categories = Object.entries(CATEGORIES) as [
    Category,
    (typeof CATEGORIES)[Category],
  ][];

  return (
    <div className="app-shell">
      {installEvent && (
        <div className="install-banner">
          <p>Εγκατάσταση ως εφαρμογή για γρηγορότερη πρόσβαση και ειδοποιήσεις.</p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => {
              await installEvent.prompt();
              await installEvent.userChoice;
              setInstallEvent(null);
            }}
          >
            Εγκατάσταση
          </button>
        </div>
      )}

      <h1 className="brand">Ναυσιπλοΐα</h1>
      <p className="subtitle">
        Ερωτήσεις από την περιγραφή/χρήση· απάντηση ο ελληνικός όρος (με
        αγγλικά στην αποκάλυψη). Δουλεύει ως PWA σε κάθε συσκευή.
      </p>
      <p className="meta">{TERMS.length} όροι στο γλωσσάρι</p>

      <div className="stack">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            navigate(`/term/${getRandomTerm().id}?mode=quiz&category=all`)
          }
        >
          <span className="label">Ξεκίνα εκμάθηση</span>
          <span className="hint">Τυχαίες ερωτήσεις</span>
        </button>

        <Link className="btn btn-secondary" to={`/term/${TERMS[0].id}?mode=browse&category=all`}>
          Λεξικό (όλοι οι όροι)
        </Link>

        <Link className="btn btn-secondary" to="/settings">
          Ειδοποιήσεις & ρυθμίσεις
        </Link>
      </div>

      <h2 className="section-title">Κατηγορίες</h2>
      <div className="grid">
        {categories.map(([key, meta]) => (
          <button
            key={key}
            type="button"
            className="cat-card"
            style={{ borderColor: meta.color }}
            onClick={() =>
              navigate(`/term?mode=quiz&category=${key}`)
            }
          >
            <span className="icon">{meta.icon}</span>
            <span className="el">{meta.el}</span>
            <span className="en">{meta.en}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
