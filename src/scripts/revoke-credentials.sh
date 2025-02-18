#!/bin/bash
set -e

echo "Starting credential revocation process..."

# Revoke Stripe webhooks
echo "Revoking Stripe webhooks..."
curl -X POST https://api.stripe.com/v1/webhook_endpoints \
  -u "${STRIPE_SECRET_KEY}:" \
  -d "enabled=false"

# Disable MongoDB user
echo "Restricting MongoDB access..."
mongosh "${MONGODB_URI}" \
  --eval 'db.revokeRolesFromUser("echosadmn", ["readWriteAnyDatabase"])'

echo "Credential revocation completed." 