-- review_log: the table definition, kept here so the schema is on record.
--
-- ALREADY APPLIED. Nothing in this repository runs it, and it does not need to be run: the table exists on the live database. Running the file again
-- changes nothing (create-if-not-exists; policies dropped and put back as they were; grants set to what they already are).
--
-- WHERE THIS COMES FROM. The live definition, as the owner read it off the database: the columns (information_schema), the five CHECK constraints
-- (pg_get_constraintdef, copied as they came), the foreign key and its name, the primary key and the two indexes (pg_indexes), the two policies with the roles
-- they apply to (pg_policies), the grants, and that row level security is enabled. Everything below is that.
--
-- APPEND-ONLY FOR USERS, BY DESIGN. A signed-in user can read their own rows and add rows with their own user_id, and nothing else: the table is a history, and
-- a row, once written, is not rewritten or deleted by the app. The grants are what enforce it (section 4), the policies narrow it to the user's own rows
-- (section 3). This is why the client's write is "insert ... on conflict (id) do nothing", never a merging upsert (that would be an UPDATE, which is refused).
--
-- The rows are the history of every answer (Review ratings, Learn introductions, Matching and Cloze answers, and Matching on a Learn batch: mode 'practice').
-- Only Review ratings change a word's schedule; every other mode is marked with its mode and changes nothing (src/data/reviewLog.ts has the rules per column).
--
-- History of the mode list: review_log_mode_check allowed review, learn, matching and cloze until 'practice' was added to it by the owner on the live database
-- (Matching on the words of a Learn batch just finished, offered on Learn's end screen). It is told apart from 'matching' so that it can be left out of anything
-- fitted to the user's own memory: it happens minutes after the words were met, not days.


-- 1. The table.
create table if not exists public.review_log (
  id                 uuid        not null,                                              -- made on the client, once: a retry inserts the same id and is ignored
  user_id            uuid        not null,
  es_word            text        not null,                                              -- the word in its stored casing, as progress rows carry it
  reviewed_at        timestamptz not null default now(),
  rating             smallint    not null,                                              -- 1 Again, 2 Hard, 3 Good, 4 Easy; a stand-in outside Review
  mode               text        not null,
  state_before       text        not null,
  elapsed_days       numeric,                                                           -- days since the previous review; null when it cannot be told
  scheduled_days     integer,                                                           -- days the word is scheduled out; null for practice on a word with no interval
  interval_after     integer,
  ease_after         numeric,
  repetitions_after  integer,
  stability_after    numeric,                                                           -- for a later scheduler; not filled in
  difficulty_after   numeric,                                                           -- for a later scheduler; not filled in
  algo               text        not null default 'sm2',                                -- which scheduler made the numbers
  session_id         uuid,                                                              -- the sitting: a Review session, a Learn batch, a Matching group or practice run, a Cloze session
  duration_ms        integer,

  constraint review_log_pkey primary key (id),
  constraint review_log_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint review_log_algo_check check ((algo = ANY (ARRAY['sm2'::text, 'fsrs'::text]))),
  constraint review_log_duration_ms_check check (((duration_ms IS NULL) OR (duration_ms >= 0))),
  constraint review_log_mode_check check ((mode = ANY (ARRAY['review'::text, 'learn'::text, 'matching'::text, 'cloze'::text, 'practice'::text]))),
  constraint review_log_rating_check check (((rating >= 1) AND (rating <= 4))),
  constraint review_log_state_before_check check ((state_before = ANY (ARRAY['new'::text, 'learning'::text, 'review'::text, 'relearning'::text])))
);


-- 2. Indexes (the primary key's, review_log_pkey, is above).
create index if not exists review_log_user_time_idx on public.review_log (user_id, reviewed_at desc);
create index if not exists review_log_user_word_time_idx on public.review_log (user_id, es_word, reviewed_at desc);


-- 3. Row level security (enabled): a user sees and adds only their own rows.
alter table public.review_log enable row level security;

drop policy if exists review_log_insert_own on public.review_log;
create policy review_log_insert_own on public.review_log for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists review_log_select_own on public.review_log;
create policy review_log_select_own on public.review_log for select to authenticated using (auth.uid() = user_id);


-- 4. Grants: what makes the table append-only for users. authenticated may INSERT and SELECT and nothing else (no UPDATE, DELETE, TRUNCATE, REFERENCES or
--    TRIGGER); anon has nothing; service_role and postgres have everything (postgres owns the table).
revoke all on public.review_log from anon;
revoke all on public.review_log from authenticated;
grant select, insert on public.review_log to authenticated;
grant all on public.review_log to service_role;


-- Read-only queries to check this file against the live database again (run in the Supabase SQL editor; they change nothing):
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'review_log' order by ordinal_position;
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.review_log'::regclass order by conname;
--   select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'review_log';
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'review_log';
--   select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'review_log' order by 1, 2;
--   select relrowsecurity from pg_class where oid = 'public.review_log'::regclass;
