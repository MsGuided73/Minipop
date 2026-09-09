-- =====================================================================
-- Migration: Projects — a second grouping dimension for boards
--
-- The redesigned workspace explorer groups boards two ways:
--   Subjects — the folder a board lives in (pop_folders, already exists)
--   Projects — cross-cutting work that spans subjects (this migration)
--
-- These are deliberately independent: a board sits in at most one folder AND
-- at most one project, so "Sacred Geometry" can be filed under Spirit Science
-- while also belonging to the YouTube Channel project.
--
-- Follows the conventions established by migrate_protect_ownership.sql:
--   user_id NOT NULL, DEFAULT auth.uid(), ON DELETE RESTRICT
-- so deleting an account can never silently destroy projects either.
--
-- pop_boards.project_id is ON DELETE SET NULL on purpose — deleting a project
-- should unfile its boards, never delete them. Losing a grouping is an
-- inconvenience; losing 174 boards is not.
--
-- Run with:
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/migrate_add_projects.sql
-- =====================================================================

begin;

create table if not exists pop_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete restrict,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists pop_projects_user_id_idx on pop_projects (user_id);

alter table pop_boards
  add column if not exists project_id uuid references pop_projects(id) on delete set null;

create index if not exists pop_boards_project_id_idx on pop_boards (project_id);

-- ── RLS, matching the other tables ───────────────────────────────────
alter table pop_projects enable row level security;

drop policy if exists projects_own on pop_projects;
create policy projects_own on pop_projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;

-- ── Verify ───────────────────────────────────────────────────────────
select 'pop_projects' as obj,
       (select count(*)::text from pop_projects) as rows,
       (select c.relrowsecurity::text from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'pop_projects') as rls,
       (select count(*)::text from pg_policies where tablename = 'pop_projects') as policies
union all
select 'pop_boards.project_id',
       (select count(*)::text from information_schema.columns
         where table_name = 'pop_boards' and column_name = 'project_id'),
       coalesce((select rc.delete_rule from information_schema.referential_constraints rc
          join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
         where tc.table_name = 'pop_boards' and rc.delete_rule = 'SET NULL'
           and tc.constraint_name like '%project%' limit 1), 'n/a'),
       '-';
