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
your project's URL and anon key:

```bash
cp .env.example .env.local
```

## Deploying to Vercel

1. Push this repo to GitHub (if not already).
2. In the Vercel dashboard, click **Add New → Project** and import this repository.
   Vercel will auto-detect the Vite framework preset — no build command changes needed
   (`npm run build`, output directory `dist`).
3. Before the first deploy (or in Project Settings → Environment Variables afterward),
   set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Set these yourself with your actual Supabase project values — they are not stored
   in this repo.
4. Deploy. Vercel will give you a `https://<project>.vercel.app` URL.
5. Set that URL as your bot's Mini App URL via [@BotFather](https://t.me/BotFather)
   (`/newapp` or `/myapps` → your bot → configure Web App URL) to open it inside
   Telegram.

`vercel.json` in this repo adds an SPA rewrite so client-side routing (once added)
won't 404 on refresh.
