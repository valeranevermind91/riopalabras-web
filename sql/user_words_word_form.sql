-- user_words.word_form_in_example: the word as it stands in the row's example sentence ("Tengo" for tener), so the card can highlight an inflected form.
--
-- NOT RUN BY THE REPOSITORY. Run it once, in the Supabase SQL editor, BEFORE the version of the app that reads the column is deployed. (If it is deployed first, the app does not break:
-- it reads the words again without the column and saves them without it, and only the highlighting of inflected forms is missing until this has been run.)
--
-- What it does: adds one nullable text column with no default and no constraint. Existing rows get NULL, which the app reads as "no form stored" (the card then looks for the
-- headword in the sentence, as it always did). Row level security and the grants are table-wide, so they cover the new column without a change. The Flutter app names its
-- columns when it writes, so it leaves this one alone. Running it twice does nothing.
--
-- Who writes it: the lookup (the proxy's /enrich, which only passes it on when it really stands in the sentence) and the form that saves a word, which drops it again if the
-- sentence is edited so that it is no longer there.
alter table public.user_words add column if not exists word_form_in_example text;

-- To check it afterwards (changes nothing):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'user_words' and column_name = 'word_form_in_example';
-- To take it out again, should that ever be wanted (the app keeps working without it):
--   alter table public.user_words drop column word_form_in_example;
