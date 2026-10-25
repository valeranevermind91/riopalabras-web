import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE, buildReport, feedbackContext, toFeedbackRow, type FeedbackKind, type FeedbackScreen } from './feedback'

// sql/feedback.sql is the record of the table (it is already applied; nothing runs it). It must not drift from what the app writes.
const sql = readFileSync('sql/feedback.sql', 'utf8')
/** The table's named constraints, each as the one line the file gives it (whitespace made single). */
const constraints = Object.fromEntries([...sql.matchAll(/^ {2}constraint ([a-z_]+) (.*?),?$/gm)].map((m) => [m[1], m[2].replace(/\s+/g, ' ')]))
const body = sql.match(/create table if not exists public\.feedback \(([\s\S]*?)\n\);/)![1]
const kinds = { word: true, general: true } satisfies Record<FeedbackKind, true> // fails to compile when FeedbackKind gains a kind
/** A context with nothing read from the page (there is no window here). */
const context = (screen: FeedbackScreen) => feedbackContext(screen, { appVersion: 'v', uiLanguage: 'en', platform: 'android' })
const screens = { settings: true, word: true, learn: true } satisfies Record<FeedbackScreen, true> // and when FeedbackScreen gains a place

describe('sql/feedback.sql', () => {
  it('says it is already applied, and that the table is append-only for users by design', () => {
    expect(sql).toMatch(/ALREADY APPLIED/)
    expect(sql).toMatch(/APPEND-ONLY FOR USERS, BY DESIGN/)
  })

  it('has the table\'s columns: every column the app writes, and the three the database and the notifier own, and no other', () => {
    const columns = body
      .split('\n')
      .map((line) => line.match(/^ {2}([a-z_]+) {2,}/)?.[1])
      .filter((c): c is string => Boolean(c))
    const built = buildReport({ id: 'i', kind: 'word', esWord: 'a', text: 'x', context: context('word') })
    if (!built.ok) throw new Error('no report')
    expect(columns.sort()).toEqual([...Object.keys(toFeedbackRow('u', built.report)), 'created_at', 'status', 'notified_at'].sort())
  })

  it('has the live column types, nullability and defaults (as read off the database)', () => {
    const column = (name: string) => body.split('\n').find((line) => new RegExp(`^ {2}${name} {2,}`).test(line))!.replace(/--.*$/, '').trim().replace(/,$/, '').replace(/\s+/g, ' ')
    expect(column('id')).toBe('id uuid not null')
    expect(column('user_id')).toBe('user_id uuid not null')
    expect(column('created_at')).toBe('created_at timestamptz not null default now()')
    expect(column('kind')).toBe('kind text not null')
    expect(column('es_word')).toBe('es_word text')
    expect(column('message')).toBe('message text not null')
    expect(column('app_version')).toBe('app_version text')
    expect(column('ui_language')).toBe('ui_language text')
    expect(column('screen')).toBe('screen text')
    expect(column('platform')).toBe('platform text')
    expect(column('status')).toBe("status text not null default 'new'")
    expect(column('notified_at')).toBe('notified_at timestamptz')
  })

  it('has the five constraints exactly as the live database defines them, under the names it gave them', () => {
    expect(constraints).toEqual({
      feedback_pkey: 'primary key (id)',
      feedback_user_id_fkey: 'foreign key (user_id) references auth.users (id) on delete cascade',
      feedback_kind_check: "check ((kind = ANY (ARRAY['word'::text, 'general'::text])))",
      feedback_message_check: 'check (((char_length(btrim(message)) >= 1) AND (char_length(btrim(message)) <= 2000)))',
      feedback_status_check: "check ((status = ANY (ARRAY['new'::text, 'read'::text, 'done'::text])))",
    })
  })

  it('allows exactly the kinds the app can write, and the message limit is the app\'s own', () => {
    const listed = [...constraints.feedback_kind_check.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
    expect(listed).toEqual(Object.keys(kinds).sort())
    expect(constraints.feedback_message_check).toContain(`<= ${MAX_MESSAGE})`)
  })

  it('puts no constraint on the screen, and names the places the app writes from', () => {
    expect(Object.keys(constraints).filter((name) => /screen/.test(name) || /screen/.test(constraints[name]))).toEqual([])
    for (const screen of Object.keys(screens)) expect(sql).toContain(`'${screen}'`)
  })

  it('never lets the app write a status, or a notified_at: those are the admin\'s and the notifier\'s', () => {
    const built = buildReport({ id: 'i', kind: 'general', esWord: null, text: 'x', context: context('settings') })
    if (!built.ok) throw new Error('no report')
    const written = Object.keys(toFeedbackRow('u', built.report))
    expect(written).not.toContain('status')
    expect(written).not.toContain('notified_at')
  })

  it('has the three indexes besides the key', () => {
    expect(sql).toMatch(/create index if not exists feedback_created_idx on public\.feedback \(created_at desc\);/)
    expect(sql).toMatch(/create index if not exists feedback_status_idx on public\.feedback \(status, created_at desc\);/)
    expect(sql).toMatch(/create index if not exists feedback_unnotified_idx on public\.feedback \(created_at\) where \(notified_at is null\);/)
  })

  it('has row level security enabled, before the policies that rely on it', () => {
    const enable = sql.indexOf('alter table public.feedback enable row level security;')
    expect(enable).toBeGreaterThan(-1)
    expect(enable).toBeLessThan(sql.indexOf('create policy'))
    expect(sql).not.toMatch(/disable row level security/i)
  })

  it('lets a user read and add their own rows and nothing else: two policies, and grants of INSERT and SELECT only', () => {
    expect(sql).toMatch(/create policy feedback_insert_own on public\.feedback for insert to authenticated with check \(auth\.uid\(\) = user_id\);/)
    expect(sql).toMatch(/create policy feedback_select_own on public\.feedback for select to authenticated using \(auth\.uid\(\) = user_id\);/)
    expect(sql.match(/create policy/g)).toHaveLength(2) // no update or delete policy
    expect(sql.match(/^create policy .* to authenticated /gm)).toHaveLength(2) // both for authenticated, neither for everyone
    const grants = [...sql.matchAll(/^grant ([a-z, ]+) on public\.feedback to ([a-z_]+);/gm)].map((m) => [m[2], m[1]])
    expect(grants).toEqual([['authenticated', 'select, insert'], ['service_role', 'all']])
    expect(sql).toMatch(/^revoke all on public\.feedback from anon;/m)
    expect(sql).toMatch(/^revoke all on public\.feedback from authenticated;/m) // before the grant above it: a grant never widens what was there
    expect(sql.indexOf('revoke all on public.feedback from authenticated')).toBeLessThan(sql.indexOf('grant select, insert'))
  })

  it('cascades with the user, as every table with a user_id does (the deletion paragraph of the privacy text relies on it)', () => {
    expect(constraints.feedback_user_id_fkey).toBe('foreign key (user_id) references auth.users (id) on delete cascade')
  })

  it('marks nothing as a guess: no reconstructed, inferred or unrecorded part is left in it', () => {
    expect(sql).not.toMatch(/reconstruct|guess|infer|not recorded|written to fit|unknown|not read|not given|were not|STILL TO RECORD|NOT YET COMPLETE/i)
  })

  it('holds no secret or key', () => {
    // service_role is a database role here (the grant to it, and the lines that name the roles), not a key: those are taken out, nothing else may name it
    const rest = sql.replace(/^grant all on public\.feedback to service_role;$/m, '').replace(/^--.*service_role.*$/gm, '')
    expect(rest).not.toMatch(/eyJ|sk-|service_role|[A-Za-z0-9+/]{40,}/)
  })
})
