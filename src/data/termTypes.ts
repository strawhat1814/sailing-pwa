export type Category =
  | 'ropes'
  | 'sails'
  | 'hardware'
  | 'hull'
  | 'rigging'
  | 'maneuvers'
  | 'deck'
  | 'navigation'
  | 'safety'
  | 'weather';

export interface Term {
  id: string;
  el: string;
  en: string;
  meaning: string;
  category: Category;
  question: string;
  icon: string;
}

export const CATEGORIES: Record<
  Category,
  { el: string; en: string; icon: string; color: string }
> = {
  ropes: { el: 'Σχοινιά', en: 'Ropes & Lines', icon: '🪢', color: '#8B5E3C' },
  sails: { el: 'Πανιά', en: 'Sails', icon: '⛵', color: '#2E6B8A' },
  hardware: { el: 'Ανταλλακτικά', en: 'Hardware', icon: '🔧', color: '#5C6B73' },
  hull: { el: 'Γάστρα', en: 'Hull', icon: '🚢', color: '#1F4E5F' },
  rigging: { el: 'Εξάρτηση', en: 'Rigging', icon: '🗼', color: '#3D5A6C' },
  maneuvers: { el: 'Χειρισμοί', en: 'Maneuvers', icon: '🧭', color: '#C45C26' },
  deck: { el: 'Κατάστρωμα', en: 'Deck', icon: '🪵', color: '#6B4F3A' },
  navigation: { el: 'Ναυτιλία', en: 'Navigation', icon: '🗺️', color: '#2F5D50' },
  safety: { el: 'Ασφάλεια', en: 'Safety', icon: '🛟', color: '#B33A3A' },
  weather: { el: 'Καιρός', en: 'Weather', icon: '🌬️', color: '#4A7C9B' },
};
