export interface Category {
  id: string
  name: string
  slug: string
  icon: string
  image_url: string | null
  total_count: number
  is_active: boolean
  created_at: string
}

export interface City {
  id: string
  name: string
  slug: string
}

export interface Listing {
  id: string
  user_id: string
  category_id: string | null
  category?: Category
  user?: Profile
  title: string
  description: string | null
  price: number | null
  price_type: string
  condition: 'new' | 'used' | null
  location: string | null
  images: string[]
  is_featured: boolean
  listing_priority: number
  status: string
  rating: number
  reviews_count: number
  created_at: string
  featured_until: string | null
  city_id: string | null
}

export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  phone: string | null
  rating: number
  reviews_count?: number
  total_sales: number
  total_listings: number
  subscription_type: string
  subscription_expires_at: string | null
  location: string | null
  is_admin: boolean
  created_at: string
}

export interface Conversation {
  id: string
  listing_id: string | null
  user1_id: string
  user2_id: string
  last_message_at: string
  created_at: string
  listing?: Listing
  other_user?: Profile
  last_message?: Message
  unread_count?: number
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  created_at: string
  sender?: Profile
}

export interface SubscriptionPlan {
  id: string
  name: string
  slug: string
  price: number
  currency: string
  features: string[]
  listing_priority: number
  max_images: number
  max_featured: number
  featured_duration_days: number
  is_active: boolean
  created_at: string
}

export interface Review {
  id: string
  listing_id: string
  reviewer_id: string
  rating: number
  comment: string
  created_at: string
  reviewer?: Profile
}

export interface Subscription {
  id: string
  user_id: string
  plan_id: string | null
  status: string
  started_at: string
  expires_at: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: 'review' | 'subscription_expiring' | 'message'
  title: string
  body: string
  data: Record<string, any>
  is_read: boolean
  created_at: string
}
