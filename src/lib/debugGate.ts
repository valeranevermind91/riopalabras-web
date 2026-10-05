import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Who may open the Debug screen: Telegram user ids listed in VITE_DEBUG_TG_IDS (comma-separated).
 * Empty or unset means nobody. This hides the screen; it is not a security boundary (the bundle
 * is public). What protects the data is Supabase row-level security, which the Debug tools go through like any other write.
 */

/** "123, 456" → {123, 456}. Blank entries, anything that is not a positive whole number, and duplicates are dropped. */
export function parseAllowedIds(raw: string | undefined | null): ReadonlySet<number> {
  const ids = new Set<number>()
  for (const part of (raw ?? '').split(',')) {
    const text = part.trim()
    if (/^\d+$/.test(text)) {
      const id = Number(text)
      if (Number.isSafeInteger(id) && id > 0) ids.add(id)
    }
  }
  return ids
}

/** The proxy creates every Telegram user with the email tg_<id>@telegram.riopalabras.internal (see riopalabras-proxy/telegram-auth.js). */
const TELEGRAM_EMAIL = /^tg_(\d+)@telegram\.riopalabras\.internal$/

export function telegramIdFromEmail(email: string | null | undefined): number | null {
  const m = TELEGRAM_EMAIL.exec(email ?? '')
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * The Telegram id of the signed-in user as Supabase Auth itself reports it: getUser() asks the
 * auth server to validate the access token and returns the stored user, so nothing local (the
 * stored session, Telegram's initDataUnsafe, the URL) can change the answer. The id comes from the
 * account's email, which the proxy sets and a user cannot change without confirming a mail that
 * goes nowhere. user_metadata is deliberately NOT used: a user can edit their own metadata.
 * Null when the lookup fails or the account is not a Telegram account.
 */
export async function verifiedTelegramId(client: Pick<SupabaseClient, 'auth'>): Promise<number | null> {
  try {
    const { data, error } = await client.auth.getUser()
    if (error) return null
    return telegramIdFromEmail(data.user?.email)
  } catch {
    return null
  }
}

export interface DebugGateInput {
  allowedIds: ReadonlySet<number>
  /** The verified id (see verifiedTelegramId); null when unknown. */
  telegramId: number | null
  /** import.meta.env.DEV */
  isDev: boolean
  /** True when there is no Telegram context (the dev mock), i.e. plain-browser local development. */
  noTelegramContext: boolean
}

/** Local dev outside Telegram is always allowed; everywhere else the verified id must be on the list. */
export function isDebugAllowed({ allowedIds, telegramId, isDev, noTelegramContext }: DebugGateInput): boolean {
  if (isDev && noTelegramContext) return true
  return telegramId !== null && allowedIds.has(telegramId)
}

/**
 * The whole decision, including the lookup: with an empty list the answer is no and no request is
 * made; in dev outside Telegram it is yes without a request.
 */
export async function resolveDebugAccess(
  client: Pick<SupabaseClient, 'auth'>,
  opts: { allowedIds: ReadonlySet<number>; isDev: boolean; noTelegramContext: boolean },
): Promise<boolean> {
  if (opts.isDev && opts.noTelegramContext) return true
  if (opts.allowedIds.size === 0) return false
  return isDebugAllowed({ ...opts, telegramId: await verifiedTelegramId(client) })
}
