import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REVIEW_LOG_MODES } from '../testing/fakeServer'
import type { LogMode, LogState } from './reviewLog'
import { toReviewLogRow } from './writes'

// sql/review_log.sql is the record of the table (it is already applied; nothing runs it). It must not drift from what the app writes.
const sql = readFileSync('sql/review_log.sql', 'utf8')
/** The table's named constraints, each as the one line the file gives it (whitespace made single). */
const constraints = Object.fromEntries(
  [...sql.matchAll(/^ {2}constraint ([a-z_]+) (.*?),?$/gm)].map((m) => [m[1], m[2].replace(/\s+/g, ' ')]),
)
const modes = { review: true, learn: true, matching: true, cloze: true, practice: true } satisfies Record<LogMode, true> // fails to compile when LogMode gains a mode

describe('sql/review_log.sql', () => {
  it('says it is already applied, and that the table is append-only for users by design', () => {
    expect(sql).toMatch(/ALREADY APPLIED/)
    expect(sql).toMatch(/APPEND-ONLY FOR USERS, BY DESIGN/)
  })

  it('allows exactly the modes the app can write: the constraint, the app\'s LogMode and the fake server\'s copy of the rule are one list', () => {
    const listed = [...constraints.review_log_mode_check.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
    expect(listed).toEqual(Object.keys(modes).sort())
    expect([...REVIEW_LOG_MODES].sort()).toEqual(listed)
  })

  it('has the table\'s columns: every column the app writes, and no other', () => {
    const body = sql.match(/create table if not exists public\.review_log \(([\s\S]*?)\n\);/)![1]
    const columns = body
      .split('\n')
      .map((line) => line.match(/^ {2}([a-z_]+) {2,}/)?.[1])
      .filter((c): c is string => Boolean(c))
    const row = toReviewLogRow('u', { id: 'i', esWord: 'a', reviewedAt: new Date(0).toISOString(), rating: 3, mode: 'practice', stateBefore: 'new', elapsedDays: null, scheduledDays: null, intervalAfter: 0, easeAfter: 2.5, repetitionsAfter: 1, sessionId: null, durationMs: null })
    expect(columns.sort()).toEqual(Object.keys(row).sort())
  })

  it('has the live column types and nullability (as read off the database)', () => {
    const body = sql.match(/create table if not exists public\.review_log \(([\s\S]*?)\n\);/)![1]
    const column = (name: string) => body.split('\n').find((line) => new RegExp(`^ {2}${name} {2,}`).test(line))!.replace(/--.*$/, '').trim().replace(/,$/, '').replace(/\s+/g, ' ')
    expect(column('id')).toBe('id uuid not null')
    expect(column('user_id')).toBe('user_id uuid not null')
    expect(column('es_word')).toBe('es_word text not null')
    expect(column('reviewed_at')).toBe('reviewed_at timestamptz not null default now()')
    expect(column('rating')).toBe('rating smallint not null')
    expect(column('mode')).toBe('mode text not null')
    expect(column('state_before')).toBe('state_before text not null')
    expect(column('elapsed_days')).toBe('elapsed_days numeric')
    expect(column('scheduled_days')).toBe('scheduled_days integer')
    expect(column('interval_after')).toBe('interval_after integer')
    expect(column('ease_after')).toBe('ease_after numeric')
    expect(column('repetitions_after')).toBe('repetitions_after integer')
    expect(column('stability_after')).toBe('stability_after numeric')
    expect(column('difficulty_after')).toBe('difficulty_after numeric')
    expect(column('algo')).toBe("algo text not null default 'sm2'")
    expect(column('session_id')).toBe('session_id uuid')
    expect(column('duration_ms')).toBe('duration_ms integer')
  })

  it('has the five CHECK constraints exactly as the live database defines them, the primary key and the foreign key', () => {
    expect(constraints).toEqual({
      review_log_pkey: 'primary key (id)',
      review_log_user_id_fkey: 'foreign key (user_id) references auth.users (id) on delete cascade',
      review_log_algo_check: "check ((algo = ANY (ARRAY['sm2'::text, 'fsrs'::text])))",
      review_log_duration_ms_check: 'check (((duration_ms IS NULL) OR (duration_ms >= 0)))',
      review_log_mode_check: "check ((mode = ANY (ARRAY['review'::text, 'learn'::text, 'matching'::text, 'cloze'::text, 'practice'::text])))",
      review_log_rating_check: 'check (((rating >= 1) AND (rating <= 4)))',
      review_log_state_before_check: "check ((state_before = ANY (ARRAY['new'::text, 'learning'::text, 'review'::text, 'relearning'::text])))",
    })
  })

  it('the checks on the states and the rating are the ones the app keeps to: every state the log can name, and ratings 1 to 4 (clampRating)', () => {
    const states = [...constraints.review_log_state_before_check.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
    expect(states).toEqual(Object.keys({ new: 1, learning: 1, review: 1, relearning: 1 } satisfies Record<LogState, 1>).sort())
    expect(constraints.review_log_rating_check).toBe('check (((rating >= 1) AND (rating <= 4)))')
  })

  it('has the two indexes', () => {
    expect(sql).toMatch(/create index if not exists review_log_user_time_idx on public\.review_log \(user_id, reviewed_at desc\);/)
    expect(sql).toMatch(/create index if not exists review_log_user_word_time_idx on public\.review_log \(user_id, es_word, reviewed_at desc\);/)
  })

  it('has row level security enabled, before the policies that rely on it', () => {
    const enable = sql.indexOf('alter table public.review_log enable row level security;')
    expect(enable).toBeGreaterThan(-1)
    expect(enable).toBeLessThan(sql.indexOf('create policy'))
    expect(sql).not.toMatch(/disable row level security/i)
  })

  it('lets a user read and add their own rows and nothing else: two policies, and grants of INSERT and SELECT only', () => {
    expect(sql).toMatch(/create policy review_log_insert_own on public\.review_log for insert to authenticated with check \(auth\.uid\(\) = user_id\);/)
    expect(sql).toMatch(/create policy review_log_select_own on public\.review_log for select to authenticated using \(auth\.uid\(\) = user_id\);/)
    expect(sql.match(/create policy/g)).toHaveLength(2) // no update or delete policy
    expect(sql.match(/^create policy .* to authenticated /gm)).toHaveLength(2) // both for authenticated, neither for everyone
    const grants = [...sql.matchAll(/^grant ([a-z, ]+) on public\.review_log to ([a-z_]+);/gm)].map((m) => [m[2], m[1]])
    expect(grants).toEqual([['authenticated', 'select, insert'], ['service_role', 'all']])
    expect(sql).toMatch(/^revoke all on public\.review_log from anon;/m)
    expect(sql).toMatch(/^revoke all on public\.review_log from authenticated;/m) // before the grant above it: a grant never widens what was there
    expect(sql.indexOf('revoke all on public.review_log from authenticated')).toBeLessThan(sql.indexOf('grant select, insert'))
  })

  it('cascades with the user, as every table with a user_id does (the deletion paragraph of the privacy text relies on it), under the name the database gave it', () => {
    expect(constraints.review_log_user_id_fkey).toBe('foreign key (user_id) references auth.users (id) on delete cascade')
  })

  it('marks nothing as a guess: no reconstructed, inferred or unrecorded part is left in it', () => {
    expect(sql).not.toMatch(/reconstruct|guess|infer|not recorded|written to fit|unknown|not read|not given|were not/i)
  })

  it('holds no secret or key', () => {
    // service_role is a database role here (the grant to it, and its mention in the header and the grant's comment), not a key: those are taken out, nothing else may name it
    const rest = sql.replace(/^grant all on public\.review_log to service_role;$/m, '').replace(/^-- .*service_role and postgres.*$/m, '')
    expect(rest).not.toMatch(/eyJ|sk-|service_role|[A-Za-z0-9+/]{40,}/)
  })
})
