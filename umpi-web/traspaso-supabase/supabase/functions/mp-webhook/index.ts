import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // --- 1. Parse payload (JSON or form-encoded) ---
    const contentType = req.headers.get('content-type') || ''
    let body: Record<string, unknown> = {}

    if (contentType.includes('application/json')) {
      body = await req.json()
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData()
      for (const [k, v] of form.entries()) {
        body[k] = v
      }
    } else {
      // Try JSON as fallback
      try {
        body = await req.json()
      } catch {
        // ignore parse errors
      }
    }

    // --- 2. Log full payload for debugging ---
    console.log('mp-webhook received:', JSON.stringify({ headers: Object.fromEntries(req.headers.entries()), body }, null, 2))

    // --- 3. Extract event ID and type from query params (IPN) or body (Webhooks) ---
    const url = new URL(req.url)
    const queryType = url.searchParams.get('type') || url.searchParams.get('topic')
    const queryDataId = url.searchParams.get('data.id') || url.searchParams.get('id')
    const bodyDataId = (body as any).data?.id
    const bodyId = (body as any).id
    const eventType = (body as any).type || (body as any).action || queryType

    let dataId: string | null = queryDataId || bodyDataId || bodyId
    let preapprovalId: string | null = null

    if (!dataId) {
      console.log('mp-webhook: no event ID found in payload — acking anyway')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // --- 3.5 Resolve the preapproval ID from the event ---
    // subscription_authorized_payment: data.id is the AUTHORIZED PAYMENT (invoice) id,
    // NOT the preapproval id. Fetch the invoice to get preapproval_id + external_reference.
    // subscription_preapproval / preapproval.*: data.id IS the preapproval id.
    if (eventType === 'subscription_authorized_payment') {
      const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
      if (!mpAccessToken) {
        return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const invoiceResponse = await fetch(
        `https://api.mercadopago.com/authorized_payments/${dataId}`,
        {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        },
      )

      if (!invoiceResponse.ok) {
        const mpError = await invoiceResponse.text()
        console.error('Failed to fetch invoice from MP:', mpError)
        return new Response(JSON.stringify({ error: 'Failed to fetch invoice from MP' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const invoice = await invoiceResponse.json()
      preapprovalId = invoice.preapproval_id || null
      if (!preapprovalId) {
        console.error('Invoice has no preapproval_id:', JSON.stringify(invoice))
        return new Response(JSON.stringify({ error: 'Invoice has no preapproval_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      console.log(`mp-webhook: resolved invoice ${dataId} -> preapproval ${preapprovalId}`)
    } else {
      preapprovalId = dataId
    }

    if (!preapprovalId) {
      console.log('mp-webhook: no preapproval ID found in payload — acking anyway')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // --- 4. Fetch preapproval from MercadoPago to get authoritative status ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const mpResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
        },
      },
    )

    if (!mpResponse.ok) {
      const mpError = await mpResponse.text()
      console.error('Failed to fetch preapproval from MP:', mpError)
      return new Response(JSON.stringify({ error: 'Failed to fetch preapproval from MP' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const preapproval = await mpResponse.json()

    // --- 5. Parse external_reference to identify user and plan ---
    // Format: sub_{user_id}_{plan_id}
    const externalReference: string | undefined = preapproval.external_reference
    if (!externalReference || !externalReference.startsWith('sub_')) {
      console.error('Invalid or missing external_reference:', externalReference)
      return new Response(JSON.stringify({ error: 'Invalid external_reference' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const parts = externalReference.split('_')
    if (parts.length !== 3) {
      console.error('Unexpected external_reference format:', externalReference)
      return new Response(JSON.stringify({ error: 'Invalid external_reference format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const [, userId, planId] = parts

    // --- 6. Process status change ---
    const mpStatus: string = preapproval.status

    if (mpStatus === 'authorized') {
      // Upsert subscription
      const { error: upsertError } = await supabaseAdmin
        .from('subscriptions')
        .upsert({
          user_id: userId,
          plan_id: planId,
          mp_preapproval_id: preapprovalId,
          external_reference: externalReference,
          status: 'active',
          started_at: preapproval.date_created,
          expires_at: preapproval.next_billing_date,
          featured_used: 0,
          period_start: new Date().toISOString(),
        }, { onConflict: 'mp_preapproval_id' })

      if (upsertError) {
        console.error('Failed to upsert subscription:', upsertError)
        return new Response(JSON.stringify({ error: 'Database error during upsert' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Fetch plan slug for profile update
      const { data: plan } = await supabaseAdmin
        .from('subscription_plans')
        .select('slug')
        .eq('id', planId)
        .single()

      // Update profile (no listings touched — toggle + RPC handle featuring)
      if (plan?.slug) {
        await supabaseAdmin
          .from('profiles')
          .update({
            subscription_type: plan.slug,
            subscription_expires_at: preapproval.next_billing_date,
          })
          .eq('id', userId)
      }

      console.log(`Subscription authorized: user=${userId} plan=${planId} mp_id=${preapprovalId}`)
    } else if (mpStatus === 'cancelled') {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('mp_preapproval_id', preapprovalId)

      await supabaseAdmin
        .from('profiles')
        .update({ subscription_type: 'none', subscription_expires_at: null })
        .eq('id', userId)

      // Listings stay featured until featured_until expires — cron handles cleanup
      console.log(`Subscription cancelled: user=${userId} mp_id=${preapprovalId}`)
    } else if (mpStatus === 'expired') {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('mp_preapproval_id', preapprovalId)

      await supabaseAdmin
        .from('profiles')
        .update({ subscription_type: 'none', subscription_expires_at: null })
        .eq('id', userId)

      // Listings stay featured until featured_until expires — cron handles cleanup
      console.log(`Subscription expired: user=${userId} mp_id=${preapprovalId}`)
    } else {
      console.log(`Unhandled preapproval status: ${mpStatus} for id=${preapprovalId}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('mp-webhook error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
})
