/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_PROXY_URL: string
  /** The bot's username (not a URL), for the About link. Empty, unset or REPLACE_ME: no link. */
  readonly VITE_BOT_USERNAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
