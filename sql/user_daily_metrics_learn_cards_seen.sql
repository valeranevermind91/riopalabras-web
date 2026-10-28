-- user_daily_metrics.learn_cards_seen: how many of the day's Learn cards the person reached (the furthest card, 1 for the first), so "left after card 3" can be told from "read all ten".
--
-- NOT RUN BY THE REPOSITORY. Run it once, in the Supabase SQL editor, BEFORE the version of the app that writes the column is deployed. (If it is deployed first, the app does not
-- break: the day's summary is refused by name and sent again without the column, and only this one figure is missing until this has been run.)
--
-- What it does: adds one nullable integer column with no default and no constraint. Existing rows get NULL, which the app reads as 0 (no card reached that day). Row level
-- security and the grants are table-wide, so they cover the new column without a change. The Flutter app names its columns when it writes, so it leaves this one alone.
-- Running it twice does nothing.
--
-- Who writes it: the app, with the rest of the day's summary (a counter that only goes up, so the larger figure wins when two devices send one). It is a count and nothing else:
-- no word, no card, nothing the person typed.
alter table public.user_daily_metrics add column if not exists learn_cards_seen integer;

-- To check it afterwards (changes nothing):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'user_daily_metrics' and column_name = 'learn_cards_seen';
-- To take it out again, should that ever be wanted (the app keeps working without it):
--   alter table public.user_daily_metrics drop column learn_cards_seen;
