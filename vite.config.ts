import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'
import { buildDefines } from './buildInfo.ts'

/**
 * /privacy is a page of its own (privacy.html), not a screen of the Mini App: it loads without Telegram, sign-in or Supabase, and nothing from another
 * site. In production vercel.json serves it at /privacy; this does the same for the dev server and `vite preview`, which would otherwise answer every
 * unknown path with the app's index.html.
 */
export const PRIVACY_ROUTE = /^\/privacy\/?(?=\?|$)/
const privacyRoute = (req: Connect.IncomingMessage, _res: unknown, next: () => void) => {
  if (req.url && PRIVACY_ROUTE.test(req.url)) req.url = req.url.replace(PRIVACY_ROUTE, '/privacy.html')
  next()
}
const privacyPage = (): Plugin => ({
  name: 'privacy-page',
  configureServer: (server) => void server.middlewares.use(privacyRoute),
  configurePreviewServer: (server) => void server.middlewares.use(privacyRoute),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), privacyPage()],
  define: buildDefines(),
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
      },
    },
  },
})
