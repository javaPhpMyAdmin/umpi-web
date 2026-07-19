import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Listing } from '../types'

export const PAGE_SIZE = 24

interface UserListingsPage {
  items: Listing[]
  nextCursor: string | null
}

interface ListingsCursor {
  listing_priority: number
  created_at: string
  id: string
}

export function useUserListings(userId: string) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery<UserListingsPage>({
    queryKey: ['listings', 'user', userId],
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('listings')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('listing_priority', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })

      if (pageParam) {
        const cursor = JSON.parse(pageParam as string) as ListingsCursor
        query = query.or(
          `listing_priority.lt.${cursor.listing_priority},` +
          `and(listing_priority.eq.${cursor.listing_priority},created_at.lt.${cursor.created_at}),` +
          `and(listing_priority.eq.${cursor.listing_priority},created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
        )
      }

      query = query.limit(PAGE_SIZE + 1)

      const { data, error } = await query
      if (error) throw error

      const items = data as Listing[]
      const hasMore = items.length > PAGE_SIZE
      const slicedItems = hasMore ? items.slice(0, PAGE_SIZE) : items

      const lastItem = slicedItems[slicedItems.length - 1]
      const nextCursor = hasMore && lastItem
        ? JSON.stringify({
            listing_priority: lastItem.listing_priority ?? 0,
            created_at: lastItem.created_at,
            id: lastItem.id,
          })
        : null

      return { items: slicedItems, nextCursor }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: async (listingId: string) => {
      const { error } = await supabase
        .from('listings')
        .delete()
        .eq('id', listingId)
        .eq('user_id', userId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings', 'user', userId] })
    },
  })

  return {
    ...query,
    deleteListing: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  }
}

// Flatten pages helper (same pattern as useListings)
export function flattenUserListings(data: { pages: UserListingsPage[] } | undefined): Listing[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}
