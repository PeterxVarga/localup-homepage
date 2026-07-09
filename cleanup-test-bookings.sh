#!/bin/bash
# Clean up test bookings created by E2E tests
set -e

cd /home/petervarga/Documents/localup-homepage

pkill -f "astro dev" 2>/dev/null || true
sleep 1
rm -f cleanup-e2e.log

timeout 60 ./node_modules/.bin/astro dev --host 0.0.0.0 > cleanup-e2e.log 2>&1 &
SERVER_PID=$!
sleep 6

cleanup_server() {
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup_server EXIT

# Booking IDs to clean up
for BOOKING_ID in "$@"; do
  echo "Cleaning up booking $BOOKING_ID"
  TOKEN=$(npx tsx get-test-token.ts "$BOOKING_ID")
  curl -s -X POST http://localhost:4321/api/audit/cancel \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOKEN\"}" > /dev/null
  echo "Cancelled $BOOKING_ID"
done

echo "Done. Delete rows from Supabase if desired."
