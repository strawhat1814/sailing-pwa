# Sailing push server (Node — for Lunes)

Plain Node HTTP server. Deploy with **git** (no zip/SFTP needed).

## Deploy on Lunes (Console)

1. Create a **Node.js** server on Lunes.
2. Open **Console** and run:

```bash
git clone https://github.com/strawhat1814/sailing-pwa.git repo
cp -r repo/push-server/. .
rm -rf repo
npm install
```

3. In **Variables**, set:

| Name | Value |
|------|--------|
| `PORT` or `SERVER_PORT` | the port shown in the Lunes panel |
| `VAPID_PUBLIC_KEY` | `BKPjkYH16YAQmBxARvV_IjRTsAhHRMSbLA8zcPY1--ULq8H-m9e7DJ1ZX7VyZFF7IrVlQuBEOlYmEjsA-2fg220` |
| `VAPID_PRIVATE_JWK` | one-line JWK JSON (from your local `push-server/.dev.vars`) |
| `ALLOWED_ORIGINS` | `https://strawhat1814.github.io` |

4. **Startup command**:

```bash
npm start
```

5. Start the server. Check: `http://YOUR_IP:PORT/health` → `{"ok":true}`

### Later updates

```bash
git clone https://github.com/strawhat1814/sailing-pwa.git repo
cp -r repo/push-server/. .
rm -rf repo
npm install
```

Then restart.

## Wire the PWA

In the app repo root, `.env.production`:

```
VITE_PUSH_API_URL=https://YOUR-LUNES-HOST:PORT
VITE_VAPID_PUBLIC_KEY=BKPjkYH16YAQmBxARvV_IjRTsAhHRMSbLA8zcPY1--ULq8H-m9e7DJ1ZX7VyZFF7IrVlQuBEOlYmEjsA-2fg220
```

Then `npm run deploy`.

## Local test

```bash
cd push-server
export VAPID_PRIVATE_JWK='(...from .dev.vars...)'
npm install
npm start
```
