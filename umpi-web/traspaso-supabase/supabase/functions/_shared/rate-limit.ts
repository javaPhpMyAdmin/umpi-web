import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SERVICE_ROLE_KEY environment variables are required')
}
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
 * Implementation: ONE atomic round trip to the `bump_rate_limit` RPC
 * (supabase/migrations/20260730000003_rate_limit_rpc_and_policy.sql). The RPC
 * inserts-or-increments the counter with INSERT ... ON CONFLICT on the
 * (user_id, function_name, window_start) unique constraint and returns the
 * POST-increment count. There is no read-modify-write race anymore, so the old
 * compare-and-swap retry loop is gone and contention errors can't happen.
 *
 * Deny semantics are preserved from the previous limiter, which denied BEFORE
 * incrementing (the request that would take the count past maxRequests was
 * refused). The RPC returns the post-increment count, so an allowed request is
 * one where the new count stays <= maxRequests, and the request that raises
 * the count to maxRequests + 1 is denied (count > maxRequests).
 *
 * Note: the RPC window is a fixed calendar minute (date_trunc('minute',
 * now())), so windowSeconds must be 60 — all current callers use 60.
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

  // Calculate the start of the current window (minute-aligned, matching
  // date_trunc('minute', now()) inside bump_rate_limit). Used to compute
  // retryAfterSeconds for denied requests.
  const now = new Date()
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowSeconds * 1000)) * (windowSeconds * 1000)
  )

  // Atomic increment + read in one round trip: the RPC bumps the counter and
  // returns the new value, so no SELECT-then-UPDATE race is possible.
  const { data: count, error } = await supabaseAdmin.rpc('bump_rate_limit', {
    p_user_id: userId,
    p_function_name: functionName,
  })
  if (error) throw error

  const requestCount = Number(count)

  // Deny when the post-increment count exceeds the limit. (The denied request
  // itself was already counted by the RPC; the practical effect — a user over
  // the limit stays blocked until the window rolls over — is unchanged.)
  if (requestCount > maxRequests) {
    // Calculate when the next window starts
    const nextWindow = new Date(windowStart.getTime() + windowSeconds * 1000)
    const retryAfterSeconds = Math.ceil((nextWindow.getTime() - now.getTime()) / 1000)

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
    }
  }

  return {
    allowed: true,
    remaining: maxRequests - requestCount,
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
