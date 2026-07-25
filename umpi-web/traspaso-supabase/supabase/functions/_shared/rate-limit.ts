import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

interface RateLimitConfig {
  functionName: string
  maxRequests: number
  windowSeconds: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Check and increment rate limit for a user + function.
 *
 * How it works (simple explanation):
 * - We have a table `rate_limits` that stores: user_id, function_name, window_start, request_count
 * - Each "window" is a time period (e.g., 60 seconds)
 * - When a request comes in, we check: how many requests has this user made in this window?
 * - If under the limit → allow and increment counter
 * - If over the limit → deny and tell them when to retry
 *
 * @param userId - The authenticated user's ID
 * @param config - Rate limit configuration
 * @returns RateLimitResult with allowed flag and metadata
 */
export async function checkRateLimit(
  userId: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const { functionName, maxRequests, windowSeconds } = config

  // Calculate the start of the current window
  // Example: if windowSeconds = 60, and it's 14:35:22,
  // windowStart = 14:35:00 (rounded down to the nearest minute)
  const now = new Date()
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowSeconds * 1000)) * (windowSeconds * 1000)
  )

  // Try to get existing record for this user + function + window
  const { data: existing } = await supabaseAdmin
    .from('rate_limits')
    .select('request_count')
    .eq('user_id', userId)
    .eq('function_name', functionName)
    .eq('window_start', windowStart.toISOString())
    .single()

  const currentCount = existing?.request_count ?? 0

  // Check if limit exceeded
  if (currentCount >= maxRequests) {
    // Calculate when the next window starts
    const nextWindow = new Date(windowStart.getTime() + windowSeconds * 1000)
    const retryAfterSeconds = Math.ceil((nextWindow.getTime() - now.getTime()) / 1000)

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
    }
  }

  // Increment counter (upsert: create or increment)
  if (existing) {
    await supabaseAdmin
      .from('rate_limits')
      .update({ request_count: currentCount + 1 })
      .eq('user_id', userId)
      .eq('function_name', functionName)
      .eq('window_start', windowStart.toISOString())
  } else {
    await supabaseAdmin
      .from('rate_limits')
      .insert({
        user_id: userId,
        function_name: functionName,
        window_start: windowStart.toISOString(),
        request_count: 1,
      })
  }

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    retryAfterSeconds: 0,
  }
}

/**
 * Create a standard rate limit exceeded response
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      message: `Has excedido el límite. Intentá de nuevo en ${result.retryAfterSeconds} segundos.`,
      retryAfter: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Remaining': String(result.remaining),
      },
    }
  )
}
