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
--   2. Nobody reads it through the client. RLS is on with no policies for
--      anon or authenticated, which denies everything: a browser holding a
--      user's own JWT still cannot select its own ciphertext. Only the
--      server's service_role, which bypasses RLS, can read these rows, and
--      only to make a call on that user's behalf.
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
  'Readable only by service_role; see supabase/user_keys.sql.';
comment on column public.pop_user_keys.hint is
  'Masked fragment for display ("sk-…7Xb2"). Safe to show; never enough to use.';

-- Deleting a user's account takes their keys with it, via the cascade above.

create index if not exists pop_user_keys_user_idx on public.pop_user_keys (user_id);

-- ── Access ───────────────────────────────────────────────────────────────
-- RLS on, no policies: deny by default, for every role that goes through it.
-- service_role bypasses RLS, which is exactly and only how the server reads.
alter table public.pop_user_keys enable row level security;

-- Belt and braces: even if a policy is added here by accident later, the
-- client roles have no table privileges to exercise it with.
revoke all on public.pop_user_keys from anon, authenticated;

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
