/** A stored settings value on one line: JSON, cut so a long list (learn_picks) doesn't fill the screen. */
function showValue(value: unknown): string {
  const json = JSON.stringify(value) ?? String(value)
  return json.length > 80 ? `${json.slice(0, 77)}…` : json
}

/** Every key of the stored settings blob, whatever it is: nothing here is a fixed list, so a key one screen writes shows up without touching this. */
export function settingsEntries(raw: Readonly<Record<string, unknown>>): [string, string][] {
  return Object.keys(raw)
    .sort()
    .map((key) => [key, showValue(raw[key])])
}
