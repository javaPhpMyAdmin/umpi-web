import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * expire-trials — Edge function that expires trial subscriptions.
 *
 * Deploy: supabase functions deploy expire-trials
 * Schedule: set up a cron job in Supabase Dashboard → Database → Cron Jobs
 *
 * SQL for cron (run once in SQL Editor):
 * SELECT cron.schedule(
 *   'expire-trials-daily',
 *   '0 3 * * *',
 *   $$SELECT net.http_post(
 *     url := (SELECT current_setting('app.settings.supabase_url') || '/functions/v1/expire-trials'),
 *     headers := jsonb_build_object(
 *       'Authorization', 'Bearer ' || (SELECT current_setting('app.settings.service_role_key'))
 *     )
 *   )$$
 * );
 */
serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Find users whose trial has ended
  const { data, error } = await supabase
    .from('profiles')
    .update({ subscription_status: 'expired' })
    .lt('trial_ends_at', new Date().toISOString())
    .eq('subscription_status', 'trial')
    .select('id')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ expired: data?.length ?? 0 }))
})
