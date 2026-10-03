import { execSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const env = { ...process.env, GITHUB_ACTIONS: 'true' };

execSync('npx tsc --noEmit', { stdio: 'inherit', env });
execSync('npx vite build', { stdio: 'inherit', env });
copyFileSync('dist/index.html', 'dist/404.html');
execSync('npx gh-pages -d dist -m "Deploy Ναυσιπλοΐα PWA"', {
  stdio: 'inherit',
  env,
});

console.log('\nPublished → https://strawhat1814.github.io/sailing-pwa/\n');
