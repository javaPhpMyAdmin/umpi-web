# Expiry Cron — `expire-pending-subscriptions`

Hourly slow-path reconciler for the subscription duplicate-prevention change.
It cleans up what the checkout guard and webhook leave behind: stale pending
checkouts and unresolved conflict markers.

## Job

| Field | Value |
|-------|-------|
| Job name | `expire-pending-subscriptions` |
| Schedule | Hourly (every hour, on the hour) |
| Endpoint | `https://<project-ref>.supabase.co/functions/v1/expire-pending-subscriptions` |
| Method | `POST` |
| Auth | `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` |

## What it does

Cancels stale pending subscriptions (created more than 24 hours ago) after
confirming their MercadoPago status — a paid preapproval is recovered to
active, never blindly cancelled — and converges duplicate-conflict markers by
cancelling the duplicate preapproval and clearing the marker. It never
modifies user profiles and never touches pending rows younger than 24 hours.

## Auth

The cron must send the service role key as a bearer token:

```
POST https://<project-ref>.supabase.co/functions/v1/expire-pending-subscriptions
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
```

- The function compares the bearer against its `SUPABASE_SERVICE_ROLE_KEY`
  environment value with a **timing-safe** comparison and returns `401` on any
  mismatch, `405` on non-`POST`.
- **`SUPABASE_SERVICE_ROLE_KEY` is a server secret. Never place it in client
  code, browser bundles, or public repos.** It is only used server-to-server
  (Supabase dashboard → edge function).

## Creating the dashboard cron (one-time ops step)

1. Open the Supabase Dashboard for the project (which mirrors the
   `traspaso-supabase` config).
2. Go to **Edge Functions** → select `expire-pending-subscriptions`.
3. Open **Cron / Integrations** and create a new scheduled job:
   - Method: `POST`
   - Schedule: hourly (e.g. cron `0 * * * *`)
   - Authorization header: `Bearer <SUPABASE_SERVICE_ROLE_KEY>`
4. Save and confirm one manual run succeeds (expect HTTP 200 with a JSON body
   like `{"cancelled":0,"activated":0,"markers_cleared":0,"deferred":0}`).

The function is safe to run early or extra times — all writes are conditional,
so concurrent runs converge without double-cancelling.

## Alerting / monitoring

- **Marker escalation (> 6h)**: if a `conflict_resolution_pending = true`
  marker row stays unresolved for more than 6 hours (aged by `created_at` —
  the table has no `updated_at`), the function logs a `console.error` line
  starting with `ESCALATION — conflict marker ... stuck >6h`. A stuck marker
  means a duplicate preapproval was not cancelled yet and could keep billing;
  alert on this log line and investigate MercadoPago.
- **Deferred rows** (`deferred > 0`) are retried hourly by design; a
  persistently non-zero count in the run log is worth watching.

## Prerequisites

- `MP_ACCESS_TOKEN` environment variable set on the edge function (needed to
  query and cancel MercadoPago preapprovals).
- The `subscription_dupe_prevention` migration applied (provides the
  `conflict_resolution_pending` column and the
  `clear_profile_subscription_if_no_active` RPC the other functions rely on).
