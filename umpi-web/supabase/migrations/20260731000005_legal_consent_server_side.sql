-- Migration: legal consent — server-side recording (review-risk fixes)
--
-- Audit findings closed here:
--   1. Consent recording was a plain client INSERT into legal_consents.
--      RLS + the tamper trigger only checked ownership (user_id =
--      auth.uid()), so a client could REST-INSERT rows with ANY
--      version / accepted_at — e.g. a fabricated version string — and
--      the gate's "accepted the current version" check would pass
--      without the user ever reading the current text. Recording now
--      goes through a SECURITY DEFINER RPC that validates the version
--      against a server-side registry, stamps accepted_at server-side,
--      and writes both documents in one idempotent statement.
--   2. Default privileges over-granted the table. Supabase's ALTER
--      DEFAULT PRIVILEGES GRANT ALL ON TABLES gave anon/authenticated
--      SELECT+INSERT on legal_consents. The client role now keeps
--      SELECT only; INSERT lives exclusively inside the definer RPC.
--
-- THE VERSION GATE IS NOW SERVER-ENFORCED: the client ships the current
-- text under LEGAL_VERSION (see src/features/legal/legalContent.ts), but
-- the RPC rejects any version missing from legal_consent_versions. A
-- client version bump alone can no longer unlock the gate — the new
-- version must ALSO be seeded here in a migration, and users who accepted
-- only an older version are re-gated until they accept the new text.
--
-- SCOPE DECISION (documented, decision: "document scope and proceed"):
-- server-side enforcement covers the INTEGRITY of the acceptance record
-- (valid version, server-stamped accepted_at, single write path). Usage
-- gating ("must accept the current version before using the app") remains
-- at the UX layer (LegalConsentGate). Full server-side usage enforcement
-- via RLS on core write tables is a documented follow-up, not shipped here.

-- Server-side registry of published legal text versions. The RPC reads
-- this as SECURITY DEFINER; clients never query it.
create table if not exists public.legal_consent_versions (
  version text primary key,
  published_at timestamptz not null default now()
);

-- Seed the current published version. Future versions are added by the
-- same migration that bumps LEGAL_VERSION client-side.
insert into public.legal_consent_versions (version, published_at)
values ('2026-07-31', now())
on conflict do nothing;

-- Client roles never need the registry: only the definer RPC reads it.
revoke all on public.legal_consent_versions from anon, authenticated;

-- Deny-all RLS: the registry is the linchpin of the version gate, so even
-- if a future migration ever grants access to it, clients cannot touch it
-- (repo convention: no table without RLS). The SECURITY DEFINER RPC runs as
-- the table owner, so it bypasses RLS and keeps reading it normally.
alter table public.legal_consent_versions enable row level security;

-- The single recording path for a legal acceptance. Validates the version
-- against the registry, then inserts BOTH documents in one statement.
-- ON CONFLICT DO NOTHING makes the call idempotent: if the first attempt
-- succeeded but the client never saw the response (or a partial write ever
-- happened), re-calling cannot deadlock the gate with a duplicate-key
-- error — a partially-recorded consent never blocks the accept button.
create or replace function public.record_legal_consent(p_version text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.legal_consent_versions where version = p_version
  ) then
    raise exception 'unknown legal version';
  end if;

  insert into public.legal_consents (user_id, document, version, accepted_at)
  values
    (v_uid, 'terms', p_version, now()),
    (v_uid, 'privacy', p_version, now())
  on conflict (user_id, document, version) do nothing;
end;
$$;

alter function public.record_legal_consent(text) owner to postgres;

-- Supabase default privileges grant EXECUTE on every new function to
-- anon/authenticated (see 20260730000007). Revoke everything, then open
-- the RPC to authenticated only — anon must never reach it.
revoke all on function public.record_legal_consent(text) from public, anon, authenticated;
grant execute on function public.record_legal_consent(text) to authenticated;

-- Close the direct-INSERT bypass: the client keeps SELECT (the gate reads
-- consents) but loses INSERT entirely — the definer RPC is the only
-- writer. The 00004 INSERT policy stays as inert defense-in-depth: if
-- INSERT is ever re-granted, RLS still restricts rows to the caller.
revoke all on public.legal_consents from anon, authenticated;
grant select on public.legal_consents to authenticated;

-- Trigger hardening: accepted_at is now stamped by the server on ANY
-- insert path. The definer RPC bypasses RLS, so this trigger is the last
-- line of defense against client-supplied timestamps — a client cannot
-- backdate or predate its acceptance. The ownership check is unchanged:
-- the RPC inserts for auth.uid() itself, so it passes naturally.
-- CREATE OR REPLACE swaps the body; the existing
-- check_legal_consent_owner_trigger keeps firing unchanged. SECURITY
-- INVOKER: runs as the DML role, so auth.uid() reflects the real client
-- on direct paths and system writers without a JWT (service_role) are
-- unaffected — same convention as 00004.
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
  new.accepted_at := now();
  return new;
end;
$$;

-- Trigger functions are invoked by the executor without EXECUTE checks, so
-- revoking direct execution closes the direct-call surface (a client
-- calling the function directly) without affecting trigger firing — same
-- convention as the direct-write guards (00004, 20260731000003).
-- CREATE OR REPLACE preserves the 00004 revoke; re-stated here so this
-- migration is self-contained.
revoke all on function public.prevent_legal_consent_tampering() from public, anon, authenticated;
