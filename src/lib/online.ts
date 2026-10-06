/**
 * True only when the browser says for certain that there is no network (airplane mode, no connection). The opposite is
 * not a promise that there is one, so this is for skipping work that cannot succeed, never for deciding that something can.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
