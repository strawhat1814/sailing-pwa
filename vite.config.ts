import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Στο GitHub Actions: https://<user>.github.io/sailing-pwa/ — τοπικά: / */
const base = process.env.GITHUB_ACTIONS ? '/sailing-pwa/' : '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.svg'],
      manifest: {
        name: 'Ναυσιπλοΐα — Ορολογία',
        short_name: 'Ναυσιπλοΐα',
        description:
          'Εκμάθηση ορολογίας ιστιοπλοΐας με ερωτήσεις και ειδοποιήσεις',
        theme_color: '#0B2A3A',
        background_color: '#0B2A3A',
        display: 'standalone',
        orientation: 'portrait-primary',
        lang: 'el',
        start_url: base,
        scope: base,
        categories: ['education', 'lifestyle'],
        icons: [
          {
            src: 'icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
