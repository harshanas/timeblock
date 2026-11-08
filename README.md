# Timeblock

A single-user week planner built from the designs in `ui/`. It runs entirely on Cloudflare: one Worker serves both the SPA (Static Assets) and the `/api` routes, and the data lives in D1. It can be installed as a PWA.

Live: https://timeblocks.macrogine.workers.dev

## Layout
- `src/`: the React app. `pages/Login.tsx` and `pages/Planner.tsx` are ports of the `.dc.html` designs.
- `worker/`: the Hono API.
  - Auth is single-user, using PBKDF2 and an HMAC-signed cookie.
  - Data sync uses D1, with last-write-wins per item.
- `migrations/`: the D1 schema.
- `scripts/set-password.mjs`: hashes your password locally and stores it as a Worker secret.

## Secrets (production)
| Secret | Purpose |
|---|---|
| `ADMIN_EMAIL` | The only email that can sign in |
| `PASSWORD_HASH` | Set with `npm run set-password` (prompts for it; the plain password never leaves your machine) |
| `SESSION_SECRET` | Random key for signing session cookies. Rotating it signs everyone out. |

To change the email, run `npx wrangler secret put ADMIN_EMAIL`. To change the password, run `npm run set-password`.

## Develop
```bash
npm install
npm run db:migrate:local
npm run dev            # http://localhost:5173. The test login is in .dev.vars
```

## Deploy
```bash
npm run db:migrate:remote   # only when migrations change
npm run deploy
```

## Notes
- The app needs a connection to work. If a save fails, the app shows a banner and retries.
- When you come back to the app, it reloads data so edits made on other devices appear.
- After 5 failed sign-ins within 15 minutes, logins from that IP are blocked until the window ends.
- **Phones (under 768px):**
  - The sidebar becomes a drawer, and there are 1-day and 3-day views.
  - Long-press to move or create blocks.
  - Tap a backlog task and choose **Add to Calendar** to schedule it.
