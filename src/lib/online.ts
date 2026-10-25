/**
 * True only when the browser says for certain that there is no network (airplane mode, no connection). The opposite is
 * not a promise that there is one, so this is for skipping work that cannot succeed, never for deciding that something can.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** What the browser reports (navigator.onLine), for Debug. When it says no, a save is refused before any request is made (data/writeQueue.ts signedIn), whatever the network is really doing. */
export function browserOnline(nav: { onLine?: boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator): string {
  if (nav?.onLine === true) return 'yes'
  if (nav?.onLine === false) return 'NO (saves are refused before any request is sent)'
  return 'unknown'
}
