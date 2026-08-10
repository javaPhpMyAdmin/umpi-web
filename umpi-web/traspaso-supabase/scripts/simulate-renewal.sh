#!/usr/bin/env bash
# Simulate a MercadoPago renewal webhook (subscription_authorized_payment)
# against the deployed mp-webhook edge function.
#
# Usage:
#   MP_WEBHOOK_SECRET=<secret> INVOICE_ID=<id> ./simulate-renewal.sh
#
# This signs the exact manifest MP signs: `id:{data.id};request-id:{x-request-id};ts:{ts};`
# with HMAC-SHA256, so the edge function validates it as a genuine webhook.
# It exercises the renewal path on an already-active subscription (expires_at
# extension + LIVE_STATUSES guard), without waiting a real month.

set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-https://fvlbxnixrutffgjrohvm.supabase.co/functions/v1/mp-webhook}"
SECRET="${MP_WEBHOOK_SECRET:-}"
INVOICE_ID="${INVOICE_ID:-}"

if [[ -z "$SECRET" || -z "$INVOICE_ID" ]]; then
  echo "ERROR: MP_WEBHOOK_SECRET and INVOICE_ID are required" >&2
  exit 1
fi

TS=$(date +%s)
REQUEST_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
# MP docs: data.id must be lowercased when alphanumeric before signing
DATA_ID_LOWER=$(echo -n "$INVOICE_ID" | tr '[:upper:]' '[:lower:]')

# MP signs `id:{data.id};request-id:{x-request-id};ts:{ts};` — sections with
# missing values are omitted; request-id is included when present.
MANIFEST="id:${DATA_ID_LOWER};request-id:${REQUEST_ID};ts:${TS};"

SIGNATURE=$(printf '%s' "$MANIFEST" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

BODY=$(cat <<EOF
{"action":"subscription_authorized_payment","data":{"id":"${INVOICE_ID}"},"type":"subscription_authorized_payment"}
EOF
)

echo "== Simulating renewal webhook =="
echo "  URL:       $WEBHOOK_URL"
echo "  invoice:   $INVOICE_ID"
echo "  ts:        $TS"
echo "  request-id:$REQUEST_ID"
echo "  manifest:  $MANIFEST"
echo "  signature: ${SIGNATURE:0:16}...(${#SIGNATURE} chars)"

echo ""
echo "== POSTing to mp-webhook =="
RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-signature: ts=${TS},v1=${SIGNATURE}" \
  -H "x-request-id: ${REQUEST_ID}" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

echo "  HTTP: $HTTP_CODE"
echo "  body: $BODY_OUT"

echo ""
echo "== Expected =="
echo "  - 200: webhook accepted, renewal synced (expires_at extended +30d)"
echo "  - 401: signature rejected (bad secret/ts freshness/manifest mismatch)"
echo "  - 500: invoice resolution failed (invoice id does not exist in MP sandbox)"
