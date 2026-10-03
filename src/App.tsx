import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { TermPage } from './pages/TermPage';
import type { Category } from './data/terms';

function TermRoute() {
  const [params] = useSearchParams();
  const mode = params.get('mode') === 'browse' ? 'browse' : 'quiz';
  const category = (params.get('category') as Category | 'all' | null) ?? 'all';
  return <TermPage mode={mode} category={category} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/term/:termId?" element={<TermRoute />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
