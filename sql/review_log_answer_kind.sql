-- review_log.answer_kind: what a Cloze answer was, so that we can see how often people answer with the dictionary word, with another form of it, or with the sentence's own form.
--
-- NOT RUN BY THE REPOSITORY. Run it once, in the Supabase SQL editor, BEFORE the version of the app that writes the column is deployed. (If the app is deployed first, nothing is lost but it
-- is late: the database refuses a batch of log rows that names a column it does not have, so the rows stay on the device, the log lane gives up after its retries and sends them once this has
-- been run and the lane is next woken. Review ratings and everything else are not touched; they do not use the column.)
--
-- What it does: adds one nullable text column with no default, and a CHECK that allows NULL or one of five values. Existing rows get NULL, which is what every row that is not a Cloze
-- answer keeps for good, and what the Cloze answers logged before this get. Row level security and the grants are table-wide (the table stays append-only for users: SELECT and INSERT),
-- so they cover the new column without a change. The Flutter app names its columns when it writes, so it leaves this one alone. Running it twice does nothing.
--
-- The values, and which answer each is (the app's Cloze check, src/data/practice.ts):
--   exact     the form in the sentence (case ignored)
--   accent    the form in the sentence, with a missing or extra accent
--   headword  the dictionary word, typed instead of the form (ir for vas)
--   form      another form of the card's verb (voy, vamos, tienes for tenés): a verb only, and only one the app can vouch for (src/data/verbForms.ts)
--   wrong     none of those
-- Giving up is not an answer and has no row. The text the person typed is never logged, only this.
alter table public.review_log add column if not exists answer_kind text;

alter table public.review_log drop constraint if exists review_log_answer_kind_check;
alter table public.review_log add constraint review_log_answer_kind_check
  check (answer_kind is null or answer_kind in ('exact', 'accent', 'headword', 'form', 'wrong'));

-- To check it afterwards (changes nothing):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'review_log' and column_name = 'answer_kind';
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.review_log'::regclass and conname = 'review_log_answer_kind_check';
-- To see how people answer (changes nothing):
--   select answer_kind, count(*) from public.review_log where mode = 'cloze' group by 1 order by 2 desc;
-- To take it out again, should that ever be wanted (the app then stops being able to save Cloze rows, so deploy a version that does not write it first):
--   alter table public.review_log drop constraint review_log_answer_kind_check;
--   alter table public.review_log drop column answer_kind;
