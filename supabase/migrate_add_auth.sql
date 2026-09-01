-- =====================================================================
-- Migration: per-user ownership + row-level security
-- Table set: pop_boards, pop_folders, pop_prompts, pop_transcripts
--
-- Before this, every table had RLS disabled with zero policies and the API
-- had no authentication at all: anyone who could reach the server could read,
-- edit, or delete every board, folder, and prompt. This migration makes the
-- database itself enforce ownership, so a bug in server.js cannot leak rows.
--
-- MUST be applied together with the server + client auth changes in the same
-- commit. Enabling RLS while the API still talks to Postgres as an anonymous
-- user would deny every request.
--
-- Order matters and is deliberate:
--   Part 1 (columns + backfill) is additive and safe to run on its own.
--   Part 2 (RLS) is the switch that starts enforcing. Run only once the app
--   is sending user JWTs.
--
-- Run with:
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/migrate_add_auth.sql
--
-- Rollback: see the bottom of this file.
-- =====================================================================

begin;

-- ── Part 1: ownership columns ────────────────────────────────────────
-- Nullable at first so the backfill can run; existing rows are assigned to
-- the account that created them before multi-user existed.

alter table pop_boards  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table pop_folders add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table pop_prompts add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill: every pre-existing row belongs to the original owner.
-- 'f72313af-02e2-4fb1-8044-1ebb45de98f1' is the only confirmed account that
-- has ever signed in; the rest are unconfirmed bot signups.
update pop_boards  set user_id = 'f72313af-02e2-4fb1-8044-1ebb45de98f1' where user_id is null;
update pop_folders set user_id = 'f72313af-02e2-4fb1-8044-1ebb45de98f1' where user_id is null;
update pop_prompts set user_id = 'f72313af-02e2-4fb1-8044-1ebb45de98f1' where user_id is null;

-- Every policy below filters on user_id; without these the checks are seq scans.
create index if not exists pop_boards_user_id_idx  on pop_boards  (user_id);
create index if not exists pop_folders_user_id_idx on pop_folders (user_id);
create index if not exists pop_prompts_user_id_idx on pop_prompts (user_id);

commit;

-- ── Part 2: row-level security ───────────────────────────────────────

begin;

alter table pop_boards      enable row level security;
alter table pop_folders     enable row level security;
alter table pop_prompts     enable row level security;
alter table pop_transcripts enable row level security;

-- Re-runnable: drop before create so this file can be applied repeatedly.
drop policy if exists boards_own      on pop_boards;
drop policy if exists folders_own     on pop_folders;
drop policy if exists prompts_read    on pop_prompts;
drop policy if exists prompts_insert  on pop_prompts;
drop policy if exists prompts_update  on pop_prompts;
drop policy if exists prompts_delete  on pop_prompts;
drop policy if exists transcripts_read   on pop_transcripts;
drop policy if exists transcripts_insert on pop_transcripts;
drop policy if exists transcripts_update on pop_transcripts;

-- Boards and folders: private to their owner, all operations.
-- FOR ALL covers the upsert path (insert ... on conflict do update), which
-- needs both USING and WITH CHECK to succeed.
create policy boards_own on pop_boards
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy folders_own on pop_folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Prompts: the seeded library is shared reading for everyone; anything a user
-- writes is private to them. Seeds are readable but never writable.
create policy prompts_read on pop_prompts
  for select to authenticated
  using (is_seed = true or user_id = (select auth.uid()));

create policy prompts_insert on pop_prompts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and coalesce(is_seed, false) = false);

create policy prompts_update on pop_prompts
  for update to authenticated
  using (user_id = (select auth.uid()) and coalesce(is_seed, false) = false)
  with check (user_id = (select auth.uid()) and coalesce(is_seed, false) = false);

create policy prompts_delete on pop_prompts
  for delete to authenticated
  using (user_id = (select auth.uid()) and coalesce(is_seed, false) = false);

-- Transcripts: a shared cache keyed by video id, not user data. Any signed-in
-- user may read and populate it; giving each account its own copy would burn
-- Apify quota re-fetching videos the app already has. Deletes are not granted.
create policy transcripts_read on pop_transcripts
  for select to authenticated using (true);

create policy transcripts_insert on pop_transcripts
  for insert to authenticated with check (true);

create policy transcripts_update on pop_transcripts
  for update to authenticated using (true) with check (true);

commit;

-- ── Verify ───────────────────────────────────────────────────────────
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pop_%'
order by 1;

-- ── Rollback ─────────────────────────────────────────────────────────
-- Turning RLS back off restores the previous wide-open behaviour. Only do this
-- if the app is broken and you need access restored while debugging:
--
-- alter table pop_boards      disable row level security;
-- alter table pop_folders     disable row level security;
-- alter table pop_prompts     disable row level security;
-- alter table pop_transcripts disable row level security;
--
-- The user_id columns are harmless to leave in place.
