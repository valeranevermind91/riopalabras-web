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

## The icon

`public/favicon.svg` (the page icon of `index.html` and `privacy.html`, and the source of the bot avatar) is made by `tools/icon/make-icon.mjs`, not drawn by hand:
the letter R of Fraunces at weight 600 (the app's display face), cream (`--page`) on teal (`--teal`), the colours read from `src/tokens.css`, the letter as an
outline so the file is about 1.6 KB and needs no font. The font is `tools/icon/fraunces-latin-600-normal.woff2` (SIL Open Font License, `tools/icon/Fraunces-OFL.txt`).

```bash
node tools/icon/make-icon.mjs                        # rewrites public/favicon.svg
node tools/icon/make-icon.mjs --avatar avatar.png    # and renders the 512x512 PNG for BotFather (headless Chrome; CHROME_PATH if it is not found)
```

`tools/icon/make-icon.test.mjs` fails when `public/favicon.svg` is not exactly what the script makes, so a change to the tokens or the script must be followed by a run.

## Conventions

**Russian is written without «ё» by default.** «е» stands for «ё», so it is «ее», «еще», «пришел», «нашел». «ё» stays only where leaving it out gives a different word: **всё** (not «все»), **всём**, **чём**, **нём**, **мёд**, **осёл**, **чёрт**, **узнаёт**, **слёз**, **лёгкие** and the like.
`src/data/russianYo.test.ts` enforces it for everything the app ships in Russian (the dictionary, the overlay, the fallback examples and the interface strings): it fails on any other «ё», and when one of those words is written without its «ё». A new pair is added to the `KEPT` list in that test, with the word it would otherwise be mistaken for. Practice matching treats «е» and «ё» as the same letter (`glossKey` in `src/data/practice.ts`), so the convention is about how the text reads, not about what is accepted.

**A dictionary example shows the sense that stands first in the gloss.** The gloss lists a word's senses in order, and the places that show one of them (the card's example, and Matching, which pairs a word with its first gloss) take the first. A word whose example shows a later sense is a mismatch to fix, by changing the example or the order of the gloss. The only wording of this rule in the code is the example-generation prompt in `tools/rio-overlay/fallback.mjs` ("use the first or most common one").

*Deliberate exceptions* are decisions, and they are listed here and pinned in `src/data/exampleSense.test.ts`, which fails if one of them changes, so it is decided again and not left stale:
- **puto.** Its first gloss is the homophobic slur ("faggot (derogatory)"), and its example uses the intensifier sense ("¡Qué puto frío hace hoy!"). A safe example for a slur is worth more than the rule, so the example does not show the first sense and must not: it may never voice the slur.
- **puta.** The same reason, and the same decision. Its first gloss is the slur ("whore"), and its example uses the intensifier sense ("Esa película es una puta obra de arte"). The example may never voice the slur.

*Decided not to change.* An example that shows a second sense that is just as everyday here does not break the rule: the first gloss is not wrong, and putting one everyday sense ahead of another would be a coin toss. These entries keep their order on purpose; they are not unfinished work, and nobody needs to reopen them:
- **Both senses are everyday here (27):** dejar (leave / let), pasar (pass / happen), razón (reason / right), sonar (sound / ring), marcha (march / gear), pista (track / clue / dance floor), grado (degree / grade), título (title / degree), trampa (trap / cheat), letra (letter / lyrics), pesado (heavy / annoying), extender (extend / spread), cola (tail / queue), ensayo (essay / rehearsal), escala (scale / layover), grano (grain / pimple), abordar (board / tackle), asistencia (assistance / attendance), rango (range / rank), bono (bond / voucher / bonus), respaldo (chair back / support), chispa (spark / wit), titulado (titled / graduated), revolver (stir / rummage), encargar (entrust / order / take charge), conformar (conform / settle for), bienes (goods / assets / property).
- **disposición and reclamar:** the English and Russian glosses do not map one to one (availability against распоряжение; the Russian has no «жаловаться»), so a reorder could not keep the two languages identical.
- **lance:** a rare word whose everyday sense cannot be told.
- **Judged not to be mismatches (34):** the example shows a sub-sense or a near-synonym of the first gloss. obra, registro, crítica, vencer, entrega, extremo, categoría, joya, urgencia, consulta, cinturón, pozo, conquistar, fuga, maduro, culto, montado, antigüedad, programación, panorama, sanción, gala, liquidar, voltear, perder, referir, mundial, conservar, coincidir, correo, ánimo, situar, mudo, subida.

**Every change is asked whether it needs a "What's new" entry.** The question, before each commit: *does this change what a person sees or how a rule works?* If yes, an entry is written in `src/data/whatsNew.ts`, in both languages, and the Russian is proofread by the owner before it ships. If no, the commit message says "no entry". Entries are written by hand for changes a person would notice and are never generated from commits; invisible plumbing, fixes and copy edits are not entries, however much work they were. An entry is dated history and never states a current rule ("From 29 October, new accounts start at 5", not "the default is 5"): the rules as they stand live in "How it works". Entries stop being shown 90 days after their date, so the failure mode is silence and not a stale list; the file needs no pruning for that, only to stay under `NEWS_FILE_CAP`. `src/data/whatsNew.test.ts` pins the shape (both languages, newest first, dated `YYYY-MM-DDTHH:mm`, no current-rule wording, the app's names for things).

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
