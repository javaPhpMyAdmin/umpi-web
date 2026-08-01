-- Migration: seed legal version '2026-08-01'
--
-- The client replaced the legal texts (Términos / Política de Privacidad);
-- the frontend bumps LEGAL_VERSION to '2026-08-01' (see
-- src/features/legal/legalContent.ts). The record_legal_consent RPC
-- rejects any version missing from legal_consent_versions, so the new
-- version MUST be seeded here or the consent gate stays locked. Users who
-- accepted only an older version are re-gated until they accept the new
-- text — same contract as 20260731000005.

-- Seed the newly published version. Do NOT add grants/revokes: the registry
-- is deny-all (RLS enabled, client roles revoked) and only the SECURITY
-- DEFINER RPC reads it — same convention as 20260731000005. The RPC and
-- tamper trigger are untouched; nothing here depends on them changing.
insert into public.legal_consent_versions (version, published_at)
values ('2026-08-01', now())
on conflict do nothing;
