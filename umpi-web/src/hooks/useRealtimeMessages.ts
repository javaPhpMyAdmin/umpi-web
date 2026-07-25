import { useEffect, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Message } from '../types'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/**
 * Subscribes to real-time message inserts for a given conversation.
 * When a new message arrives, it updates the React Query cache instantly.
 * Returns the WebSocket connection status for UI feedback.
 *
 * Requires Supabase Realtime enabled on the `messages` table:
 *   Dashboard → Database → Replication → Enable for `messages`
 */
export function useRealtimeMessages(conversationId: string | null) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

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
    if (!conversationId) {
      setStatus('disconnected')
      return
    }

    setStatus('connecting')

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
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setStatus('connected')
        else if (state === 'TIMED_OUT') setStatus('reconnecting')
        else if (state === 'CLOSED' || state === 'CHANNEL_ERROR') setStatus('disconnected')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, handleNewMessage])

  return status
}
