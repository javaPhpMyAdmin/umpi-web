import { useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Message } from '../types'

/**
 * Subscribes to real-time message inserts for a given conversation.
 * When a new message arrives, it updates the React Query cache instantly.
 *
 * Requires Supabase Realtime enabled on the `messages` table:
 *   Dashboard → Database → Replication → Enable for `messages`
 */
export function useRealtimeMessages(conversationId: string | null) {
  const queryClient = useQueryClient()

  const handleNewMessage = useCallback(
    (payload: { new: Message }) => {
      if (!conversationId) return

      // Append to the first page (newest messages) of the infinite query
      queryClient.setQueryData(
        ['messages', conversationId],
        (old: any) => {
          if (!old || !old.pages || old.pages.length === 0) return old
          const firstPage = old.pages[0]
          if (firstPage.items.some((m: Message) => m.id === payload.new.id)) return old
          return {
            ...old,
            pages: [
              { ...firstPage, items: [...firstPage.items, payload.new] },
              ...old.pages.slice(1),
            ],
          }
        }
      )
    },
    [conversationId, queryClient]
  )

  useEffect(() => {
    if (!conversationId) return

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        handleNewMessage as (payload: Record<string, unknown>) => void
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, handleNewMessage])
}
