/**
 * useLegalConsents — versioned legal consent state.
 *
 * WHY VERSIONED: the current legal copy ships with the client under
 * LEGAL_VERSION (see src/features/legal/legalContent.ts). When the copy
 * changes (Términos / Política de Privacidad), bump LEGAL_VERSION — every
 * user who accepted only an older version is re-gated by LegalConsentGate
 * until they accept the new text. Old rows in `legal_consents` stay
 * untouched as the audit trail.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LEGAL_VERSION } from '../features/legal/legalContent'
import type { LegalConsent } from '../types'

/** Documents the user must accept. 'terms' = Términos, 'privacy' = Privacidad. */
export const LEGAL_DOCUMENTS = ['terms', 'privacy'] as const

/**
 * Fetch the current user's consent records.
 * Gated by `enabled: !!userId` — the query never runs without a session.
 */
export function useLegalConsents(userId: string | undefined) {
  return useQuery<LegalConsent[]>({
    queryKey: ['legal-consents', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('legal_consents')
        .select('*')
        .eq('user_id', userId)
      if (error) throw error
      return (data as LegalConsent[]) ?? []
    },
    enabled: !!userId,
  })
}

/**
 * True when the user accepted BOTH documents at the CURRENT version.
 * Older-version acceptances don't count — a version bump re-gates the user.
 */
export function hasAcceptedAll(consents: LegalConsent[] | undefined): boolean {
  if (!consents || consents.length === 0) return false
  const accepted = new Set(
    consents
      .filter((c) => c.version === LEGAL_VERSION)
      .map((c) => c.document)
  )
  return LEGAL_DOCUMENTS.every((doc) => accepted.has(doc))
}

/**
 * Record acceptance of the current legal version via the server-side RPC.
 * The RPC validates the version against legal_consent_versions and inserts
 * BOTH rows (terms + privacy) idempotently — a partial acceptance state is
 * unreachable through this mutation.
 */
export function useRecordLegalConsent() {
  const queryClient = useQueryClient()
  const { session } = useAuth()

  return useMutation({
    mutationFn: async () => {
      const userId = session?.user?.id
      if (!userId) throw new Error('No hay sesión activa')

      const { error } = await supabase.rpc('record_legal_consent', {
        p_version: LEGAL_VERSION,
      })
      if (error) throw error
    },
    onSuccess: () => {
      // Prefix match — invalidates the ['legal-consents', userId] read query.
      queryClient.invalidateQueries({ queryKey: ['legal-consents'] })
    },
  })
}

/**
 * Gate state combining session + consents. Used by LegalConsentGate.
 *
 * - needsConsent: logged-in user that has NOT accepted the current version
 * - isChecking: auth session OR consents still loading (show a loader,
 *   never flash the app before the gate decides)
 * - recordConsent: mutation that records consent via the RPC and
 *   invalidates the query
 */
export function useLegalConsentGate() {
  const { session, isLoading: isAuthLoading } = useAuth()
  const userId = session?.user?.id
  const { data: consents, isLoading, error, refetch } = useLegalConsents(userId)
  const recordMutation = useRecordLegalConsent()

  return {
    needsConsent: !!userId && !hasAcceptedAll(consents),
    isChecking: isAuthLoading || (!!userId && isLoading),
    queryError: error,
    refetch,
    recordConsent: recordMutation.mutateAsync,
    isRecording: recordMutation.isPending,
    recordError: recordMutation.error,
  }
}
