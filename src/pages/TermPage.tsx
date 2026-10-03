import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CATEGORIES,
  Category,
  Term,
  buildQuizQuestion,
  getTermById,
  getTermsByCategory,
  shuffleTerms,
} from '../data/terms';

type Props = {
  mode: 'quiz' | 'browse';
  category: Category | 'all';
  initialReveal?: boolean;
};

export function TermPage({
  mode,
  category,
  initialReveal = false,
}: Props) {
  const { termId } = useParams();
  const navigate = useNavigate();

  const deck = useMemo(() => {
    const base = getTermsByCategory(category);
    return mode === 'quiz' ? shuffleTerms(base) : base;
  }, [category, mode]);

  const initialIndex = useMemo(() => {
    if (!termId) return 0;
    const idx = deck.findIndex((t) => t.id === termId);
    return idx >= 0 ? idx : 0;
  }, [deck, termId]);

  const [index, setIndex] = useState(initialIndex);
  const [revealed, setRevealed] = useState(
    mode === 'browse' || initialReveal,
  );

  useEffect(() => {
    setIndex(initialIndex);
    setRevealed(mode === 'browse' || initialReveal);
  }, [initialIndex, mode, termId, initialReveal]);

  const term: Term | undefined =
    deck[index] ?? (termId ? getTermById(termId) : undefined);

  // Σταθερή ανά όρο — η ειδοποίηση ανοίγει πάντα την ίδια εκφώνηση
  const quizText = term && mode === 'quiz' ? buildQuizQuestion(term) : '';

  useEffect(() => {
    const current = deck[index];
    if (!current) return;

    const next =
      mode === 'browse'
        ? `/term/${current.id}?mode=browse&category=${category}`
        : `/term/${current.id}?mode=quiz&category=${category}${
            revealed ? '&reveal=1' : ''
          }`;

    const targetSearch = next.includes('?') ? `?${next.split('?')[1]}` : '';
    if (current.id !== termId || window.location.search !== targetSearch) {
      navigate(next, { replace: true });
    }
  }, [index, deck, termId, mode, category, navigate, revealed]);

  if (!term) {
    return (
      <div className="app-shell">
        <p>Δεν βρέθηκε ο όρος.</p>
        <Link className="linkish" to="/">
          ‹ Αρχική
        </Link>
      </div>
    );
  }

  const cat = CATEGORIES[term.category];
  const canPrev = index > 0;
  const canNext = index < deck.length - 1;

  const go = (delta: number) => {
    setRevealed(mode === 'browse');
    setIndex((i) => i + delta);
  };

  return (
    <div className="app-shell">
      <div className="topbar">
        <Link className="linkish" to="/">
          ‹ Αρχική
        </Link>
        <span className="progress">
          {index + 1} / {deck.length}
        </span>
      </div>

      <div className="badge" style={{ borderColor: cat.color }}>
        {cat.icon} {cat.el}
      </div>

      {mode === 'quiz' && !revealed ? (
        <>
          <div className="question-label">Ερώτηση</div>
          <h1 className="question" style={{ whiteSpace: 'pre-line' }}>
            {quizText}
          </h1>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1.5rem' }}
            onClick={() => setRevealed(true)}
          >
            <span className="label">Δείξε την απάντηση</span>
          </button>
        </>
      ) : (
        <>
          {mode === 'quiz' && quizText && (
            <p className="question-muted" style={{ whiteSpace: 'pre-line' }}>
              {quizText}
            </p>
          )}
          <div className="icon-hero">{term.icon}</div>
          <h1 className="word-el">{term.el}</h1>
          <p className="word-en">Αγγλικά: {term.en}</p>
          <div className="meaning-box">
            <div className="meaning-label">Εξήγηση</div>
            <p className="meaning">{term.meaning}</p>
          </div>
        </>
      )}

      <div className="nav-row">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canPrev}
          onClick={() => go(-1)}
        >
          ‹ Προηγούμενο
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-next"
          disabled={!canNext}
          onClick={() => go(1)}
        >
          Επόμενο ›
        </button>
      </div>
    </div>
  );
}
