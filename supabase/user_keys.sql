-- =====================================================================
-- pop_user_keys — the API key each user brings with them, at rest.
--
-- BYOK: the key belongs to the user, the app only borrows it to make the
-- call they asked for. Two rules follow from that, and both are enforced
-- here rather than left to application code:
--
--   1. The row is ciphertext. What is stored is AES-256-GCM output whose
--      decryption key lives in the server environment
--      (KEY_ENCRYPTION_SECRET), never in Postgres. A dump of this table is
--      not a list of API keys.
--
--   2. A row belongs to one user, enforced by row-level security, the same
--      way boards and prompts are. There is no service_role key in the app:
--      the server reads this table with the caller's own JWT, so nothing in
--      it can reach another user's row even by mistake.
--
--      What a browser can therefore fetch is its own ciphertext. That is not
--      a key — decryption needs KEY_ENCRYPTION_SECRET, which lives only in
--      the server environment and is never sent anywhere.
--
-- The hint (e.g. "sk-…7Xb2") exists so the settings screen can show which
-- key is saved without the key ever coming back to a browser.
-- =====================================================================

create table if not exists public.pop_user_keys (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  provider    text        not null check (provider in ('openai', 'google', 'anthropic')),

  ciphertext  text        not null,
  iv          text        not null,
  tag         text        not null,
  hint        text        not null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (user_id, provider)
);

comment on table public.pop_user_keys is
  'Per-user provider API keys, encrypted with the server''s KEY_ENCRYPTION_SECRET. '
  'Scoped to the owning user by RLS; see supabase/user_keys.sql.';
comment on column public.pop_user_keys.hint is
  'Masked fragment for display ("sk-…7Xb2"). Safe to show; never enough to use.';

-- Deleting a user's account takes their keys with it, via the cascade above.

create index if not exists pop_user_keys_user_idx on public.pop_user_keys (user_id);

-- ── Access ───────────────────────────────────────────────────────────────
-- Own rows only, for the signed-in user. anon gets nothing.
alter table public.pop_user_keys enable row level security;
revoke all on public.pop_user_keys from anon;
grant select, insert, update, delete on public.pop_user_keys to authenticated;

create policy "own keys are readable"
  on public.pop_user_keys for select to authenticated
  using (auth.uid() = user_id);

create policy "own keys are writable"
  on public.pop_user_keys for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own keys are replaceable"
  on public.pop_user_keys for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own keys are removable"
  on public.pop_user_keys for delete to authenticated
  using (auth.uid() = user_id);

-- updated_at should reflect the last time the user replaced their key.
create or replace function public.pop_user_keys_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pop_user_keys_touch on public.pop_user_keys;
create trigger pop_user_keys_touch
  before update on public.pop_user_keys
  for each row execute function public.pop_user_keys_touch();
