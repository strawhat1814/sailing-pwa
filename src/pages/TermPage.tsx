import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CATEGORIES,
  Category,
  QuizKind,
  Term,
  buildQuizQuestion,
  getTermById,
  getTermsByCategory,
  shuffleTerms,
} from '../data/terms';

type Props = {
  mode: 'quiz' | 'browse';
  category: Category | 'all';
  initialKind?: QuizKind;
  initialReveal?: boolean;
};

export function TermPage({
  mode,
  category,
  initialKind,
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
  const [quizKind, setQuizKind] = useState<QuizKind | undefined>(initialKind);
  const [quizText, setQuizText] = useState('');

  useEffect(() => {
    setIndex(initialIndex);
    setRevealed(mode === 'browse' || initialReveal);
    setQuizKind(initialKind);
  }, [initialIndex, mode, termId, initialKind, initialReveal]);

  const term: Term | undefined =
    deck[index] ?? (termId ? getTermById(termId) : undefined);

  useEffect(() => {
    if (!term || mode !== 'quiz') {
      setQuizText('');
      return;
    }
    const built = buildQuizQuestion(term, quizKind ?? initialKind);
    setQuizKind(built.kind);
    setQuizText(built.text);
  }, [term?.id, mode, index]); // intentional: quizKind/initialKind μόνο στην είσοδο του όρου

  useEffect(() => {
    const current = deck[index];
    if (!current) return;

    let next: string;
    if (mode === 'browse') {
      next = `/term/${current.id}?mode=browse&category=${category}`;
    } else if (quizKind) {
      next = `/term/${current.id}?mode=quiz&category=${category}&kind=${quizKind}${
        revealed ? '&reveal=1' : ''
      }`;
    } else {
      return;
    }

    const currentSearch = window.location.search;
    const targetSearch = next.includes('?') ? `?${next.split('?')[1]}` : '';
    if (current.id !== termId || currentSearch !== targetSearch) {
      navigate(next, { replace: true });
    }
  }, [index, deck, termId, mode, category, navigate, quizKind, revealed]);

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
    setQuizKind(undefined);
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
