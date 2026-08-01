/**
 * Shared legal version + copy for the legal consent system.
 *
 * Single source of truth for the pieces that must move in lockstep:
 * - LEGAL_VERSION: the contract with the server-side registry
 *   (legal_consent_versions). The record_legal_consent RPC rejects any
 *   version the server does not know, so bumping the copy here without
 *   seeding the version in a migration keeps the gate locked.
 * - LEGAL_VERSION_LABEL: user-facing Spanish date for the legal pages.
 * - LEGAL_GATE_SUMMARY: plain-language gate summary (paraphrase of the
 *   client's legal copy — keep in sync with PrivacyPage).
 */

/**
 * Current version of the legal texts (Términos / Política de Privacidad).
 * Bump here → also add a row to legal_consent_versions in a migration →
 * users re-gate.
 */
export const LEGAL_VERSION = '2026-08-01'

/**
 * '1 de agosto de 2026' — Spanish label for LEGAL_VERSION.
 * Parsed from the ISO parts explicitly so it is deterministic;
 * toLocaleDateString would vary with the runtime locale.
 */
export const LEGAL_VERSION_LABEL = (() => {
  const [year, month, day] = LEGAL_VERSION.split('-').map(Number)
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${day} de ${months[month - 1]} de ${year}`
})()

/**
 * Plain-language summary shown on the consent gate.
 * Paraphrase of the client's legal copy — if the client updates the
 * privacy policy, update here AND in PrivacyPage; keep in sync.
 * Deliberately generic about the data items and purposes: the 2026-08-01
 * policy collects more than the old name/email/phone trio (location, IP,
 * device data, usage stats) and uses data for fraud detection and legal
 * compliance too, so enumerating items or saying "solo para" could
 * contradict it.
 */
export const LEGAL_GATE_SUMMARY =
  'En UMPI usamos tus datos para gestionar tu cuenta, mostrar tus publicaciones y facilitar el contacto entre compradores y vendedores. No vendemos tus datos personales y aplicamos medidas de seguridad para protegerlos.'
