-- =====================================================================
-- Ownership audit for ContentLoom
--
-- Answers one question: is every row in every user-scoped table attributed
-- to the expected account, with nothing orphaned?
--
-- Read-only. Safe to run any time, and worth running after anyone new signs
-- in or after a bulk import.
--
-- Run with:
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/verify_ownership.sql
--
-- The CLI queries with a privileged role, so this sees ALL rows regardless of
-- row-level security — which is the point. Querying as a normal user would
-- only ever show that user's own rows and could not detect an orphan.
-- =====================================================================

-- Second check: pop_transcripts is intentionally unowned (a shared cache keyed
-- by video_id). It should have NO user_id column at all. If this returns a row,
-- something added one and the sharing model has drifted.
select count(*) as unexpected_user_id_column
from information_schema.columns
where table_name = 'pop_transcripts' and column_name = 'user_id';

-- Owner of record. Change this if the canonical account ever changes.
-- 620e8d16-1a29-47fa-a002-0e48e21246e4 = bensondc73@gmail.com (restored 2026-09-09)
with expected as (select '620e8d16-1a29-47fa-a002-0e48e21246e4'::uuid as owner_id),

tally as (
  select 'pop_boards'  as tbl, count(*) as total,
         count(*) filter (where user_id is null)                            as orphaned,
         count(*) filter (where user_id is distinct from (select owner_id from expected)) as other_owner
  from pop_boards
  union all
  select 'pop_folders', count(*),
         count(*) filter (where user_id is null),
         count(*) filter (where user_id is distinct from (select owner_id from expected))
  from pop_folders
  union all
  select 'pop_prompts', count(*),
         count(*) filter (where user_id is null),
         count(*) filter (where user_id is distinct from (select owner_id from expected))
  from pop_prompts
)

select tbl,
       total,
       orphaned,
       other_owner,
       case
         when orphaned > 0    then 'FAIL - rows with no owner are invisible to every user'
         when other_owner > 0 then 'REVIEW - rows belong to a different account'
         else 'OK'
       end as verdict
from tally
order by tbl;

