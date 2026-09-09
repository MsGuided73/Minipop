-- =====================================================================
-- Migration: stop account deletion from destroying data, and make
--            unattributed rows impossible
--
-- WHY THIS EXISTS
-- On 2026-09-09 the account bensondc73@gmail.com was deleted from
-- auth.users. The user_id foreign keys were ON DELETE CASCADE, so Postgres
-- silently deleted 174 boards, 2 folders, and 24 prompts along with it. No
-- error, no warning. Everything was recovered from a backup taken hours
-- earlier, but only because that backup happened to exist.
--
-- CASCADE is the conventional choice for per-user rows and it is the wrong
-- one here: it makes a single account row a delete-everything switch. This
-- migration makes the same action fail loudly instead.
--
--   1. user_id FKs: ON DELETE CASCADE -> ON DELETE RESTRICT
--        Deleting an account that still owns rows now raises a foreign key
--        violation and changes nothing.
--   2. DEFAULT auth.uid()
--        Correct attribution happens even if a caller omits user_id.
--   3. NOT NULL
--        An unattributed row is rejected. Under RLS an orphan is invisible
--        to every user, so it is lost data that still occupies the table.
--
-- Only the user_id constraints change. pop_boards.fk_folder (SET NULL) and
-- pop_folders.fk_parent (CASCADE, for nested folders) are correct domain
-- behaviour and are left alone.
--
-- SAFE TO RUN: verify_ownership.sql reports 0 orphans, so NOT NULL validates
-- without error. If it fails, run that audit first and assign the orphans.
--
-- Run with:
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/migrate_protect_ownership.sql
--
-- HOW TO DELETE AN ACCOUNT AFTER THIS
-- Deletion is now a deliberate two-step, which is the point:
--   delete from pop_boards  where user_id = '<uuid>';
--   delete from pop_folders where user_id = '<uuid>';
--   delete from pop_prompts where user_id = '<uuid>' and not is_seed;
--   -- then delete the auth user
-- Or reassign the rows to another account instead of deleting them.
-- =====================================================================

begin;

-- ── 1. Replace CASCADE with RESTRICT ─────────────────────────────────
-- A foreign key's delete rule cannot be altered in place; drop and recreate.

alter table pop_boards  drop constraint if exists pop_boards_user_id_fkey;
alter table pop_folders drop constraint if exists pop_folders_user_id_fkey;
alter table pop_prompts drop constraint if exists pop_prompts_user_id_fkey;

alter table pop_boards  add constraint pop_boards_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;
alter table pop_folders add constraint pop_folders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;
alter table pop_prompts add constraint pop_prompts_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

-- ── 2. Automatic attribution ─────────────────────────────────────────
-- auth.uid() is NULL on a privileged/service connection, so combined with
-- NOT NULL below a service-role insert must name its owner explicitly.
-- That is intended, not a limitation.

alter table pop_boards  alter column user_id set default auth.uid();
alter table pop_folders alter column user_id set default auth.uid();
alter table pop_prompts alter column user_id set default auth.uid();

-- ── 3. No unattributed rows ──────────────────────────────────────────

alter table pop_boards  alter column user_id set not null;
alter table pop_folders alter column user_id set not null;
alter table pop_prompts alter column user_id set not null;

commit;

-- ── Verify ───────────────────────────────────────────────────────────
select c.table_name,
       c.is_nullable,
       coalesce(c.column_default, '(none)') as col_default,
       rc.delete_rule,
       case
         when c.is_nullable = 'NO'
          and c.column_default is not null
          and rc.delete_rule = 'RESTRICT'
         then 'OK - data protected'
         else 'INCOMPLETE'
       end as verdict
from information_schema.columns c
join information_schema.table_constraints tc
  on tc.table_name = c.table_name and tc.constraint_name = c.table_name || '_user_id_fkey'
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
where c.column_name = 'user_id' and c.table_name like 'pop_%'
order by c.table_name;
