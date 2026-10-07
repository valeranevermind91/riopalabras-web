/**
 * The link to the bot, from the username in VITE_BOT_USERNAME (a username, not a URL: the link is built here). Null when
 * there is nothing usable (unset, empty, the REPLACE_ME placeholder, or not a Telegram username), so the About row is
 * left out instead of being a dead link. A leading @ is tolerated.
 */
export function botLink(username: string | undefined | null): string | null {
  const name = (username ?? '').trim().replace(/^@/, '')
  if (name === '' || name.toUpperCase() === 'REPLACE_ME') return null
  // Telegram usernames: 5 to 32 letters, digits and underscores, starting with a letter.
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name)) return null
  return `https://t.me/${name}`
}

/** The @name shown next to the link. */
export function botHandle(link: string): string {
  return `@${link.replace('https://t.me/', '')}`
}
