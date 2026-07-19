import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Notification } from '../types'

const PAGE_SIZE = 20

/**
 * Unread notification count for the bell badge
 */
export function useNotificationCount(userId: string | undefined) {
  return useQuery<number>({
    queryKey: ['notificationCount', userId],
    queryFn: async () => {
      if (!userId) return 0

      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)
      if (error) return 0
      return count ?? 0
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

/**
 * Infinite notification list — acumula paginas automaticamente
 */
export function useNotifications(userId: string | undefined) {
  return useInfiniteQuery<Notification[]>({
    queryKey: ['notifications', userId],
    queryFn: async ({ pageParam }) => {
      if (!userId) return []
      const from = pageParam as number
      const to = from + PAGE_SIZE - 1
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) throw error
      return (data as Notification[]) ?? []
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined
      return allPages.length * PAGE_SIZE
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

/**
 * Mark a single notification as read (on tap)
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationCount'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/**
 * Mark all notifications as read
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationCount'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/**
 * Delete a single notification
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationCount'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/**
 * Mark message notification as read when user opens the conversation directly.
 * Finds the unread message notification for a given conversation_id and marks it read.
 */
export function useMarkMessageReadByConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, conversationId }: { userId: string; conversationId: string }) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('type', 'message')
        .eq('is_read', false)
        .contains('data', { conversation_id: conversationId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationCount'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/**
 * Subscribes to real-time notification changes.
 * When a new notification arrives, refetches the unread count for the bell badge.
 *
 * Requires Supabase Realtime enabled on the `notifications` table:
 *   Dashboard → Database → Replication → Enable for `notifications`
 */
export function useRealtimeNotifications(userId: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('notifications:realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notificationCount'] })
          queryClient.invalidateQueries({ queryKey: ['notifications'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
}
