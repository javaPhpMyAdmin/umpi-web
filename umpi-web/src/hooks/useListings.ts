import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Listing } from '../types'

export interface ListingsFilters {
  categoryId?: string
  priceMin?: number
  priceMax?: number
  location?: string
  search?: string
  sortBy?: 'recent' | 'price_asc' | 'price_desc'
}

const PAGE_SIZE = 24

// Type for each page from Supabase range query
interface ListingsPage {
  items: Listing[]
  nextCursor: string | null
}

interface ListingsCursor {
  listing_priority: number
  created_at: string
  id: string
}

function buildBaseQuery(filters: ListingsFilters) {
  let query = supabase
    .from('listings')
    .select('*, category:category_id(*)')
    .eq('status', 'active')

  if (filters.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (filters.priceMin !== undefined) {
    query = query.gte('price', filters.priceMin)
  }
  if (filters.priceMax !== undefined) {
    query = query.lte('price', filters.priceMax)
  }
  if (filters.location) {
    query = query.ilike('location', `%${filters.location}%`)
  }
  if (filters.search) {
    query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`)
  }

  return query
}

function applySorting(query: ReturnType<typeof buildBaseQuery>, sortBy: ListingsFilters['sortBy']) {
  switch (sortBy) {
    case 'price_asc':
      return query.order('price', { ascending: true }).order('id', { ascending: true })
    case 'price_desc':
      return query.order('price', { ascending: false }).order('id', { ascending: true })
    case 'recent':
    default:
      return query
        .order('listing_priority', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
  }
}

export function useListings(filters: ListingsFilters = {}) {
  return useInfiniteQuery<ListingsPage>({
    queryKey: ['listings', 'infinite', filters],
    queryFn: async ({ pageParam }) => {
      let query = applySorting(buildBaseQuery(filters), filters.sortBy)

      if (pageParam) {
        const cursor = JSON.parse(pageParam as string) as ListingsCursor
        if (filters.sortBy === 'price_asc') {
          query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
        } else if (filters.sortBy === 'price_desc') {
          query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
        } else {
          // Default: recent (listing_priority DESC, created_at DESC, id DESC)
          query = query.or(
            `listing_priority.lt.${cursor.listing_priority},` +
            `and(listing_priority.eq.${cursor.listing_priority},created_at.lt.${cursor.created_at}),` +
            `and(listing_priority.eq.${cursor.listing_priority},created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
          )
        }
      }

      query = query.limit(PAGE_SIZE + 1) // fetch one extra to know if there's more

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
    staleTime: 5 * 60 * 1000,
  })
}

// Flatten pages helper
export function flattenListings(data: { pages: ListingsPage[] } | undefined): Listing[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}

// Featured listings with infinite scroll (for FeaturedPage)
export function useFeaturedListingsAllInfinite() {
  return useInfiniteQuery<ListingsPage>({
    queryKey: ['listings', 'featured', 'infinite'],
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('listings')
        .select('*, category:category_id(*)')
        .eq('status', 'active')
        .eq('is_featured', true)
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
    staleTime: 5 * 60 * 1000,
  })
}

// Keep simple versions for HomePage (small datasets)
export function useFeaturedListings(limit = 6) {
  return useQuery({
    queryKey: ['listings', 'featured'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, category:category_id(*)')
        .eq('status', 'active')
        .eq('is_featured', true)
        .order('listing_priority', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data as Listing[]
    },
  })
}

export function useRecentListings(limit = 10) {
  return useQuery({
    queryKey: ['listings', 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, category:category_id(*)')
        .eq('status', 'active')
        .eq('is_featured', false)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data as Listing[]
    },
  })
}

export function useListing(id: string) {
  return useQuery({
    queryKey: ['listings', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, category:category_id(*)')
        .eq('id', id)
        .single()

      if (error) throw error
      return data as Listing
    },
    enabled: !!id,
  })
}
