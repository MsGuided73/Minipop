-- =====================================================================
-- Migration: make correct ownership impossible to get wrong
--
-- The backfill in migrate_add_auth.sql attributed every existing row, and
-- verify_ownership.sql confirms it. But the user_id columns are still
-- NULLABLE with no default, so a future insert that forgets user_id creates
-- an ORPHAN: a row owned by nobody. Under row-level security an orphan is
-- invisible to every user, including you — it is effectively lost data that
-- still occupies the table.
--
-- server.js always sets user_id, but a dashboard insert, a one-off script,
-- or a future code path could miss it. These two constraints move the
-- guarantee from "we remembered" to "the database will not allow it".
--
--   1. DEFAULT auth.uid()  — correct attribution happens automatically
--   2. NOT NULL            — an unattributed row is rejected outright
--
-- Safe to run now: every existing row is already populated, so NOT NULL
-- validates without error. If it fails, run verify_ownership.sql first —
-- a failure means orphans exist and must be assigned before this can apply.
--
-- Run with:
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/migrate_enforce_ownership.sql
--
-- Rollback: see the bottom of this file.
-- =====================================================================

begin;

-- auth.uid() returns the caller's id, or NULL for a privileged/service
-- connection. Combined with NOT NULL, a service-role insert must therefore
-- name the owner explicitly — which is the behaviour we want, not a bug.
alter table pop_boards  alter column user_id set default auth.uid();
alter table pop_folders alter column user_id set default auth.uid();
alter table pop_prompts alter column user_id set default auth.uid();

alter table pop_boards  alter column user_id set not null;
alter table pop_folders alter column user_id set not null;
alter table pop_prompts alter column user_id set not null;

commit;

-- ── Verify ───────────────────────────────────────────────────────────
select table_name as tbl,
       is_nullable,
       coalesce(column_default, '(none)') as col_default,
       case
         when is_nullable = 'NO' and column_default is not null then 'OK - orphans impossible'
         else 'INCOMPLETE'
       end as verdict
from information_schema.columns
where column_name = 'user_id' and table_name like 'pop_%'
order by table_name;

-- ── Rollback ─────────────────────────────────────────────────────────
-- alter table pop_boards  alter column user_id drop not null;
-- alter table pop_folders alter column user_id drop not null;
-- alter table pop_prompts alter column user_id drop not null;
-- alter table pop_boards  alter column user_id drop default;
-- alter table pop_folders alter column user_id drop default;
-- alter table pop_prompts alter column user_id drop default;
