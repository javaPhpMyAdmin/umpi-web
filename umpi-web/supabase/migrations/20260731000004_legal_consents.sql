-- Migration: legal_consents — versioned legal document consents
--
-- WHY APPEND-ONLY: a consent is a fact about the past ("user X accepted
-- version V at time T"). Legal compliance needs an audit trail: if a user
-- later disputes what they agreed to, the record must still exist exactly
-- as it was. UPDATEs/DELETEs would destroy that evidence, so there are NO
-- update/delete RLS policies — the only way to change what a user is bound
-- to is to publish a NEW version and require a fresh acceptance. The unique
-- constraint (user_id, document, version) makes each acceptance a single
-- immutable fact: a user cannot accept the same version twice, and the
-- client's "accepted the current version" check is deterministic.
--
-- WHY VERSIONED: the client ships the current text under LEGAL_VERSION
-- (see src/hooks/useLegalConsent.ts). When the copy changes, the client
-- bumps the version and every user who accepted only the old version is
-- re-gated. Old rows stay as proof of what was agreed to at the time;
-- they are never migrated, rewritten, or deleted.

create table public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

alter table public.legal_consents enable row level security;

create policy "Users read own legal consents"
  on public.legal_consents for select
  using (auth.uid() = user_id);

create policy "Users insert own legal consents"
  on public.legal_consents for insert
  with check (auth.uid() = user_id);

-- No update/delete policies: consents are append-only records. The absence
-- of UPDATE/DELETE policies means PostgREST denies those verbs for
-- authenticated users at the RLS level — records are immutable once written.

grant select, insert on public.legal_consents to authenticated;

-- Defense-in-depth trigger against client-side tampering: the RLS INSERT
-- policy already blocks cross-user writes, but this guard keeps working even
-- if RLS is bypassed (e.g. a direct DB connection). Same pattern as the
-- featured-write guards (20260731000003): the check only engages when a JWT
-- identity is present, so system writers without a JWT (service_role) and
-- SECURITY DEFINER postgres paths are not blocked. accepted_at is left
-- client-settable on purpose — it is informational only (the version column
-- is what gates access), and the record is append-only, so backdating one's
-- own timestamp gains nothing.

create or replace function public.prevent_legal_consent_tampering()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if auth.uid() is not null then
    if new.user_id is distinct from auth.uid() then
      raise exception 'Cannot record consent for another user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_legal_consent_owner_trigger on public.legal_consents;
create trigger check_legal_consent_owner_trigger
  before insert on public.legal_consents
  for each row
  execute function public.prevent_legal_consent_tampering();

-- Trigger functions are invoked by the executor without EXECUTE checks, so
-- revoking direct execution closes the direct-call surface (a client calling
-- the function directly) without affecting trigger firing — same convention
-- as the direct-featured-write guards.
revoke all on function public.prevent_legal_consent_tampering() from public, anon, authenticated;
