import { useQuery } from '@tanstack/react-query'
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

export function useListings(filters: ListingsFilters = {}) {
  return useQuery({
    queryKey: ['listings', filters],
    queryFn: async () => {
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

      switch (filters.sortBy) {
        case 'price_asc':
          query = query.order('price', { ascending: true })
          break
        case 'price_desc':
          query = query.order('price', { ascending: false })
          break
        case 'recent':
        default:
          query = query.order('created_at', { ascending: false })
          break
      }

      const { data, error } = await query.limit(50)

      if (error) throw error
      return data as Listing[]
    },
  })
}

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

      // eslint-disable-next-line no-console
      console.log('Fetched listing user_id:', data?.user_id)

      if (error) throw error
      return data as Listing
    },
    enabled: !!id,
  })
}
