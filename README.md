# Ναυσιπλοΐα — PWA ορολογίας ιστιοπλοΐας

Progressive Web App που τρέχει σε **οποιοδήποτε browser** (Windows, macOS, Linux, Android, iOS) χωρίς εγκατάσταση από store.

- 255+ όροι ΕΛ/ΕΝ με εξήγηση στα ελληνικά
- Quiz με ερωτήσεις + Επόμενο / Προηγούμενο
- Τυχαίες ειδοποιήσεις (Web Notifications)
- Offline μέσω service worker
- Εγκατάσταση στην αρχική οθόνη (Add to Home Screen)

## Online (GitHub Pages)

**https://strawhat1814.github.io/sailing-pwa/**

Repo: https://github.com/strawhat1814/sailing-pwa

Για νέο deploy μετά από αλλαγές:

```bash
npm run deploy
```

## Εκκίνηση τοπικά

```bash
npm install
npm run dev
```

Άνοιξε το URL που δείχνει το Vite (συνήθως `http://localhost:5173`).

## Production / δοκιμή PWA

Οι ειδοποιήσεις και το «Εγκατάσταση» χρειάζονται συχνά HTTPS (ή localhost):

```bash
npm run build
npm run preview
```

Στο Chrome/Edge: μενού ⋮ → **Install Ναυσιπλοΐα** (ή το banner στην αρχική).

Στο iPhone: Share → **Add to Home Screen**.

## Σημειώσεις ειδοποιήσεων

- Ζήτα άδεια από **Ειδοποιήσεις & ρυθμίσεις**
- Χρησιμοποίησε «Δοκιμαστική ειδοποίηση τώρα» για έλεγχο
- Τα timers δουλεύουν όσο ο browser/PWA δεν έχει σκοτωθεί εντελώς από το OS
- Το iOS έχει περισσότερους περιορισμούς από Android/Desktop

## Δομή

- `src/data/terms.ts` — γλωσσάρι
- `src/pages/` — Αρχική, Όρος, Ρυθμίσεις
- `src/notifications.ts` — προγραμματισμός ειδοποιήσεων
- `src/sw.ts` — service worker (offline + κλικ σε notification)
