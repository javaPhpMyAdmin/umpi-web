import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import {
  cancelPreapproval,
  clearProfileSubscription,
  selectActiveFirstSubscription,
} from '../_shared/subscription.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SERVICE_ROLE_KEY environment variables are required')
}
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // --- 1. Validate JWT and get user ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- RATE LIMIT: max 3 cancel attempts per 60 seconds ---
    const rateLimit = await checkRateLimit(user.id, {
      functionName: 'cancel-subscription',
      maxRequests: 3,
      windowSeconds: 60,
    })
    if (!rateLimit.allowed) {
      console.log(`Rate limited: user=${user.id} function=cancel-subscription`)
      return rateLimitResponse(rateLimit)
    }

    // --- 2. Active-first row selection (design D4) ---
    // Explicit user intent "cancel my plan": the newest ACTIVE row is
    // cancelled; only when the user has no active row does the newest PENDING
    // row get cancelled (spec "Deterministic row selection"). This stops the
    // active billing row, never a leftover pending one. Same created_at DESC,
    // id DESC tie-break as the migration reconcile.
    const subscription = await selectActiveFirstSubscription(supabaseAdmin, user.id)

    if (!subscription) {
      return new Response(JSON.stringify({
        error: 'No se encontró una suscripción activa',
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const preapprovalId = subscription.mp_preapproval_id
    if (!preapprovalId) {
      // Unreachable in practice — selectActiveFirstSubscription filters out
      // rows without an MP preapproval id. Kept as a defensive type guard.
      return new Response(JSON.stringify({
        error: 'No se encontró el ID de preaprobación en MP',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 3. Cancel preapproval on MercadoPago ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`cancel-subscription: cancelling row=${subscription.id} status=${subscription.status} preapproval=${preapprovalId} for user=${user.id}`)

    try {
      // Shared helper: PUT status='cancelled', tolerates already-cancelled
      // (400 + GET-confirm). Throws on any real failure — never report
      // success when MP rejected the cancellation.
      await cancelPreapproval(mpAccessToken, preapprovalId)
    } catch (mpError) {
      // The helper throws with the MP HTTP status + response body embedded in
      // the message. Reconstruct the existing client-facing 502 shape from
      // it; the client only branches on error presence, but keeping the
      // original keys preserves parity with the pre-helper response.
      const message = mpError instanceof Error ? mpError.message : String(mpError)
      console.error('cancel-subscription: MercadoPago cancel failed:', message)
      const mpStatusMatch = message.match(/HTTP (\d+)/)
      const mpStatus = mpStatusMatch ? Number(mpStatusMatch[1]) : null
      return new Response(JSON.stringify({
        error: `MercadoPago rechazó la cancelación${mpStatus ? ` (HTTP ${mpStatus})` : ''}`,
        mp_status: mpStatus,
        mp_body: message,
        preapproval_id: preapprovalId,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 4. Mark cancelled locally (only after successful MP cancellation) ---
    // Result-checked update, same contract as sync-subscription's cancelled
    // branch: the row must be marked cancelled BEFORE the conditional profile
    // clear runs — never clear on a failed update.
    const { data, error: updateError } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscription.id)
      .select('id')

    if (updateError) {
      console.error('Failed to mark subscription cancelled:', updateError)
      return new Response(
        JSON.stringify({ error: 'Database error during subscription update' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!data || data.length === 0) {
      // No row was updated — a concurrent writer already moved it out of the
      // live slot. The conditional clear below stays safe because the RPC
      // re-checks active rows atomically (same reasoning as sync-subscription).
      console.log(`cancel-subscription: row ${subscription.id} already updated by another writer`)
    }

    // --- 5. Conditional profile clear ---
    // Only when the user has NO remaining row with status 'active' across all
    // plans (spec "Conditional profile clear"). The RPC re-checks atomically;
    // false means another active plan remains and the profile intentionally
    // keeps its subscription fields.
    const cleared = await clearProfileSubscription(supabaseAdmin, user.id)
    if (!cleared) {
      console.log(`cancel-subscription: profile kept for user=${user.id} (another active plan remains)`)
    }

    console.log(`Subscription cancelled: user=${user.id} mp_id=${preapprovalId}`)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('cancel-subscription error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
