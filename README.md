# Riopalabras

Telegram Mini App client. Vite + React + TypeScript SPA, no SSR.

## Local development

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL in a plain browser.

**Dev-only mock:** Telegram only provides real `initData` when the page is opened
inside the Telegram app. Outside Telegram (a plain browser, or `npm run dev`), the
app falls back to a mocked Telegram user so the UI is visible — you'll see a yellow
"Using mock Telegram data (dev only)" badge. This mock is only active when
`import.meta.env.DEV` is true (i.e. never in a production build); inside real
Telegram, or in a production build, that badge disappears and real data is used.

To test against Supabase locally, copy `.env.example` to `.env.local` and fill in
your project's URL and anon key, plus `VITE_PROXY_URL` (the proxy's base URL, no
trailing path). Real sign-in only works with real Telegram `initData`; in a plain
browser the app shows "Open inside Telegram to sign in" instead (the mock user is
for the layout only and would fail the proxy's HMAC check anyway):

```bash
cp .env.example .env.local
```

## The privacy page

`/privacy` is a page of its own (`privacy.html`, drawn by `src/privacy-main.tsx`), not a screen of the Mini App: it loads without Telegram, sign-in or
Supabase, and from no other site (no fonts, no scripts, no analytics). `vercel.json` serves it at `/privacy` (and at `/privacy/`), ahead of the rule that
sends every other path to `index.html`; the dev server and `vite preview` do the same (`vite.config.ts`). It opens in the language in the address
(`?lang=ru`, which the app adds to its link), else the one this device last used, else the browser's. The address for BotFather's Mini App /
privacy settings is `https://riopalabras-web.vercel.app/privacy`.

Its text is in `src/strings.ts` and `src/strings.ru.ts` (`privacy`), and `src/screens/Privacy.test.ts` checks every claim in it against the code (the
tables, the columns, the device storage, the third-party hosts, and, when `../riopalabras-proxy` is next to this repository, what the proxy stores and
logs). When the text changes, set `PRIVACY_UPDATED` in `src/lib/privacy.ts` to the day and update the fingerprint in that test; a test fails until both
move.

## Tests

```bash
npm test
```

Vitest, with the timezone pinned to `America/Montevideo` (see `vitest.config.ts`) so the
local-midnight and local-date tests exercise the UTC-3 case.

## Deploying to Vercel

1. Push this repo to GitHub (if not already).
2. In the Vercel dashboard, click **Add New → Project** and import this repository.
   Vercel will auto-detect the Vite framework preset — no build command changes needed
   (`npm run build`, output directory `dist`).
3. Before the first deploy (or in Project Settings → Environment Variables afterward),
   set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PROXY_URL` (e.g. `https://<proxy>.railway.app`; the proxy's
     `CORS_ALLOWED_ORIGINS` must include this site's origin)

   Set these yourself with your actual Supabase project values — they are not stored
   in this repo.
4. Deploy. Vercel will give you a `https://<project>.vercel.app` URL.
5. Set that URL as your bot's Mini App URL via [@BotFather](https://t.me/BotFather)
   (`/newapp` or `/myapps` → your bot → configure Web App URL) to open it inside
   Telegram.

`vercel.json` in this repo adds an SPA rewrite so client-side routing (once added)
won't 404 on refresh.
