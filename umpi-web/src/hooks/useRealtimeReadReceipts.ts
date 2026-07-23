import { useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Conversation } from '../types'

/**
 * Subscribes to UPDATE events on the conversations table for a specific
 * conversation. When the other user's read timestamp changes, the React
 * Query conversations cache is updated so MessageTick components re-render
 * without requiring a page refresh.
 *
 * Requires Supabase Realtime enabled on the `conversations` table:
 *   Dashboard → Database → Replication → Enable for `conversations`
 */
export function useRealtimeReadReceipts(
  conversationId: string | null,
  currentUserId: string | null
) {
  const queryClient = useQueryClient()

  const handleConversationUpdate = useCallback(
    (payload: { new: Conversation }) => {
      if (!conversationId) return

      const updated = payload.new
      if (updated.id !== conversationId) return

      // Update the conversations infinite query cache so ticks re-render
      queryClient.setQueryData(['conversations'], (old: any) => {
        if (!old || !old.pages) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((conv: Conversation) =>
              conv.id === updated.id ? { ...conv, ...updated } : conv
            ),
          })),
        }
      })
    },
    [conversationId, queryClient]
  )

  useEffect(() => {
    if (!conversationId || !currentUserId) return

    const channel = supabase
      .channel(`conversations-read:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `id=eq.${conversationId}`,
        },
        handleConversationUpdate as (payload: Record<string, unknown>) => void
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, currentUserId, handleConversationUpdate])
}
