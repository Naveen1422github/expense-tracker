# kharchly

One-tap expense tracker PWA — spend, lend/borrow, budgets, reports, Google Drive backup.
Live: https://kharchly.netlify.app · vanilla JS modules, IndexedDB, zero npm dependencies.

## run locally
```
python -m http.server 8080      # from this folder; ES modules don't load from file://
```
Open http://localhost:8080. If you see an old version: DevTools → Application → Service Workers → Unregister, then Ctrl+Shift+R.

## test
```
node --test
```

## deploy
Push to `main` — Netlify deploys automatically. **Bump `CACHE_NAME` in `sw.js` on every release.**
Never change the site URL or the IndexedDB name (`expense-db`): data is tied to both.

## google drive setup (one time)
1. https://console.cloud.google.com → create a project `kharchly`.
2. APIs & Services → Library → enable **Google Drive API**.
3. OAuth consent screen → External → app name `kharchly`, your email → add scope `.../auth/drive.file` → add yourself as a test user. (Leaving it in *Testing* is fine for personal use.)
4. Credentials → Create credentials → **OAuth client ID** → *Web application* → Authorized JavaScript origins: `https://kharchly.netlify.app` and `http://localhost:8080`. No redirect URIs.
5. Put the client ID in `js/config.js` (`GOOGLE_CLIENT_ID`), commit, push.
6. In the app: Settings → google drive → connect.

Backups land in a `Kharchly/` folder in your Drive: `summary.md` (read this first), `spend-YYYY-MM.csv`, `people.csv`, `backup.json` (for restore).

## docs
`docs/spec.md` (design) and `docs/plan-*.md` (implementation plans, in order).
