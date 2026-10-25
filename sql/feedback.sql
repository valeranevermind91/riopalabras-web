-- feedback: the table definition, kept here so the schema is on record.
--
-- ALREADY APPLIED. Nothing in this repository runs it, and it does not need to be run: the table exists on the live database. Running the file again
-- changes nothing (create-if-not-exists; policies dropped and put back as they were; grants set to what they already are).
--
-- WHERE THIS COMES FROM. The live definition, as the owner read it off the database on 2026-10-25: the columns (information_schema), the constraints with their
-- names (pg_get_constraintdef, copied as they came), the indexes (pg_indexes), the two policies with the roles they apply to (pg_policies), the grants, and that
-- row level security is enabled. Everything below is that. The table was made outside this repository; this file is the first time its definition is written down.
--
-- WHAT IT HOLDS. Messages to the developer: a free note from Settings (kind 'general') or a problem with one word (kind 'word'), written by the app
-- (src/data/feedback.ts). The proxy's notifier (riopalabras-proxy feedback-notify.js) tells the admin about every row whose notified_at is null and then sets it;
-- `status` is the admin's own triage and is never written by either.
--
-- APPEND-ONLY FOR USERS, BY DESIGN. A signed-in user can read their own rows and add rows with their own user_id, and nothing else: a row, once written, is not
-- rewritten or deleted by the app. The grants enforce it (section 4), the policies narrow it to the user's own rows (section 3). This is why the client's write is
-- "insert ... on conflict (id) do nothing", never a merging upsert (that would be an UPDATE, which is refused).
--
-- WHAT IS AND IS NOT CONSTRAINED.
--   kind     two values: 'word', 'general'.
--   status   three values: 'new', 'read', 'done'.
--   message  1 to 2000 characters after trimming (database characters, so a message of emoji that the form counts in UTF-16 units is allowed a little more than
--            the form lets through: the form is the stricter of the two, which is the safe way round).
--   screen   NOT constrained: any text, or null. The app writes 'settings' (the Settings row), 'word' (a word's detail screen) and 'learn' (Learn's card); a new place
--            needs only a new value in src/data/feedback.ts. A report from Learn's card is kind 'word': the kind has a check, and it is a report about a word.
--   app_version, ui_language, platform, es_word: free text, or null.


-- 1. The table.
create table if not exists public.feedback (
  id           uuid        not null,                                    -- made on the client, once: a retry inserts the same id and is ignored
  user_id      uuid        not null,
  created_at   timestamptz not null default now(),
  kind         text        not null,
  es_word      text,                                                    -- what a word report names; null for a general message
  message      text        not null,
  app_version  text,
  ui_language  text,
  screen       text,
  platform     text,
  status       text        not null default 'new',                      -- the admin's triage; the app and the notifier never write it
  notified_at  timestamptz,                                             -- set by the notifier once Telegram accepted the message about this row

  constraint feedback_pkey primary key (id),
  constraint feedback_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint feedback_kind_check check ((kind = ANY (ARRAY['word'::text, 'general'::text]))),
  constraint feedback_message_check check (((char_length(btrim(message)) >= 1) AND (char_length(btrim(message)) <= 2000))),
  constraint feedback_status_check check ((status = ANY (ARRAY['new'::text, 'read'::text, 'done'::text])))
);


-- 2. Indexes (the primary key's, feedback_pkey, is above).
create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
create index if not exists feedback_unnotified_idx on public.feedback (created_at) where (notified_at is null);   -- what the notifier reads, oldest first


-- 3. Row level security (enabled): a user sees and adds only their own rows.
alter table public.feedback enable row level security;

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback for select to authenticated using (auth.uid() = user_id);


-- 4. Grants: what makes the table append-only for users. authenticated may INSERT and SELECT and nothing else (no UPDATE, DELETE, TRUNCATE, REFERENCES or
--    TRIGGER); anon has nothing; service_role (the proxy's notifier, which sets notified_at) and postgres (the owner) have everything.
revoke all on public.feedback from anon;
revoke all on public.feedback from authenticated;
grant select, insert on public.feedback to authenticated;
grant all on public.feedback to service_role;


-- Read-only queries to check this file against the live database again (run in the Supabase SQL editor; they change nothing):
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'feedback' order by ordinal_position;
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.feedback'::regclass order by conname;
--   select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'feedback';
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'feedback';
--   select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'feedback' order by 1, 2;
--   select relrowsecurity from pg_class where oid = 'public.feedback'::regclass;
