-- =====================================================================
-- Migration: library-wide prompt defaults
-- Table: pop_prompts  (project: dfcppzpppqgphjjxypyw / OpenClaw)
--
-- Brings EVERY prompt in the library to the two current defaults:
--   1. default_run_mode = 'auto'  → the Lens node fires on creation
--   2. any depth/detail variable defaults to its most thorough option
--
-- Why this exists alongside the seed files: seed_prompts.sql and
-- seed_prompts_monetization.sql only recreate the 22 prompts they own.
-- Rows seeded outside the repo (e.g. 'Forensic Content Analyst') and
-- user-created variations are NOT covered by them. This file is title-
-- agnostic, so it catches those too — and any prompt added later.
--
-- Idempotent: every statement is guarded by a WHERE clause, so re-running
-- it updates 0 rows. Safe to run any time.
--
-- Run it with (no DB password needed — uses the Management API):
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/migrate_prompt_defaults.sql
--
-- Verified 2026-08-25: applied against the live project, then the UPDATE
-- logic was exercised on a temp copy degraded back to the pre-migration
-- state. It restored 24/24 run modes and 22/22 depth defaults, with zero
-- drift in variable order or in any non-depth variable.
--
-- Rollback: see the commented block at the bottom.
-- =====================================================================

begin;

-- 1 ── Autorun on creation ────────────────────────────────────────────
update pop_prompts
set default_run_mode = 'auto',
    updated_at = now()
where default_run_mode is distinct from 'auto';

-- 2 ── Exhaustive detail ──────────────────────────────────────────────
-- Rewrites the `default` of any select-type variable that controls depth
-- (depth_level, detail, thoroughness, length…) to the most thorough option
-- its own options list offers. Variables without such an option are left
-- untouched, and element order is preserved.
update pop_prompts
set variables = (
      select jsonb_agg(
               case
                 when v->>'name' ~* '(depth|detail|thorough|length|verbos)'
                  and jsonb_typeof(v->'options') = 'array'
                  and (v->'options') ? 'exhaustive'
                 then jsonb_set(v, '{default}', '"exhaustive"')
                 when v->>'name' ~* '(depth|detail|thorough|length|verbos)'
                  and jsonb_typeof(v->'options') = 'array'
                  and (v->'options') ? 'comprehensive'
                 then jsonb_set(v, '{default}', '"comprehensive"')
                 else v
               end
               order by ord
             )
      from jsonb_array_elements(variables) with ordinality as t(v, ord)
    ),
    updated_at = now()
where jsonb_typeof(variables) = 'array'
  and exists (
        select 1
        from jsonb_array_elements(variables) as v
        where v->>'name' ~* '(depth|detail|thorough|length|verbos)'
          and jsonb_typeof(v->'options') = 'array'
          and ((v->'options') ? 'exhaustive' or (v->'options') ? 'comprehensive')
          and v->>'default' not in ('exhaustive', 'comprehensive')
      );

commit;

-- ── Verify ───────────────────────────────────────────────────────────
-- Expect: every row 'auto', and no depth variable left on a shallow default.
select default_run_mode, count(*)
from pop_prompts
group by default_run_mode;

select p.title, v->>'name' as variable, v->>'default' as default_value
from pop_prompts p,
     jsonb_array_elements(p.variables) as v
where v->>'name' ~* '(depth|detail|thorough|length|verbos)'
order by p.title;

-- ── Rollback ─────────────────────────────────────────────────────────
-- The prior state was default_run_mode = 'review' and depth_level = 'standard'
-- across the whole library. To restore it, uncomment and run:
--
-- begin;
-- update pop_prompts set default_run_mode = 'review', updated_at = now();
-- update pop_prompts
-- set variables = (
--       select jsonb_agg(
--                case when v->>'name' = 'depth_level'
--                     then jsonb_set(v, '{default}', '"standard"')
--                     else v end
--                order by ord
--              )
--       from jsonb_array_elements(variables) with ordinality as t(v, ord)
--     ),
--     updated_at = now()
-- where variables @> '[{"name": "depth_level"}]';
-- commit;
