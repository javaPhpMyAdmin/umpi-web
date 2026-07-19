import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Polls the conversations list every 15 seconds instead of subscribing
 * to ALL message inserts globally.
 *
 * WHY: The previous implementation subscribed to `postgres_changes` on
 * the entire `messages` table without a user-level filter. With 1000
 * active users, every message INSERT triggered 1000 WebSocket callbacks
 * (O(N) fan-out). Polling uses a single DB query per interval regardless
 * of how many users are online.
 *
 * The active conversation still uses useRealtimeMessages (per-conversation
 * subscription) for instant message delivery.
 */
const POLL_INTERVAL = 15_000 // 15 seconds

export function useRealtimeConversations(userId: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }, POLL_INTERVAL)

    return () => clearInterval(interval)
  }, [userId, queryClient])
}
