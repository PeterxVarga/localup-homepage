#!/bin/bash
# E2E cancel flow test
set -e

cd /home/petervarga/Documents/localup-homepage

pkill -f "astro dev" 2>/dev/null || true
sleep 1
rm -f cancel-e2e.log

timeout 90 ./node_modules/.bin/astro dev --host 0.0.0.0 > cancel-e2e.log 2>&1 &
SERVER_PID=$!
sleep 6

cleanup() {
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "=== 1. Create a booking ==="
SLOTS=$(curl -s http://localhost:4321/api/audit/available-slots)
FIRST_SLOT=$(echo "$SLOTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for day in data.get('slots', []):
    if day.get('slots'):
        print(json.dumps(day['slots'][0]))
        break
")
SLOT_START=$(echo "$FIRST_SLOT" | python3 -c "import sys,json; print(json.load(sys.stdin)['start'])")
SLOT_END=$(echo "$FIRST_SLOT" | python3 -c "import sys,json; print(json.load(sys.stdin)['end'])")

BOOKING_RES=$(curl -s -X POST http://localhost:4321/api/audit/book \
  -H "Content-Type: application/json" \
  -d "{
    \"businessName\": \"Cancel E2E Business\",
    \"noWebsite\": true,
    \"city\": \"Budapest\",
    \"businessType\": \"Other local service\",
    \"goals\": [\"more_visibility\"],
    \"name\": \"Cancel E2E User\",
    \"email\": \"peter@localup.hu\",
    \"slotStart\": \"$SLOT_START\",
    \"slotEnd\": \"$SLOT_END\"
  }")
echo "$BOOKING_RES"

TOKEN=$(echo "$BOOKING_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('managementToken',''))")
BOOKING_ID=$(echo "$BOOKING_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('bookingId',''))")

if [ -z "$TOKEN" ]; then
  echo "❌ No management token returned"
  exit 1
fi
echo "✅ Booking created: $BOOKING_ID"

echo ""
echo "=== 2. GET /api/audit/manage/[token] ==="
MANAGE_RES=$(curl -s "http://localhost:4321/api/audit/manage/$TOKEN")
echo "$MANAGE_RES"
if [[ $(echo "$MANAGE_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))") != "True" ]]; then
  echo "❌ Manage lookup failed"
  exit 1
fi
echo "✅ Manage lookup succeeded"

echo ""
echo "=== 3. Invalid token returns 404 ==="
INVALID_RES=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/api/audit/manage/invalid-token-12345)
if [ "$INVALID_RES" != "404" ]; then
  echo "❌ Expected 404 for invalid token, got $INVALID_RES"
  exit 1
fi
echo "✅ Invalid token returns 404"

echo ""
echo "=== 4. POST /api/audit/cancel ==="
CANCEL_RES=$(curl -s -X POST http://localhost:4321/api/audit/cancel \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}")
echo "$CANCEL_RES"
if [[ $(echo "$CANCEL_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))") != "True" ]]; then
  echo "❌ Cancel failed"
  exit 1
fi
echo "✅ Cancel succeeded"

echo ""
echo "=== 5. Repeated cancel is idempotent ==="
CANCEL2_RES=$(curl -s -X POST http://localhost:4321/api/audit/cancel \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}")
echo "$CANCEL2_RES"
if [[ $(echo "$CANCEL2_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alreadyCancelled'))") != "True" ]]; then
  echo "❌ Repeated cancel did not return alreadyCancelled=true"
  exit 1
fi
echo "✅ Repeated cancel is idempotent"

echo ""
echo "=== 6. Slot is available again ==="
SLOTS_AFTER=$(curl -s http://localhost:4321/api/audit/available-slots)
OCCUPIED=$(echo "$SLOTS_AFTER" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(any(s['start'] == '$SLOT_START' and s['end'] == '$SLOT_END' for day in data.get('slots', []) for s in day.get('slots', [])))
")
if [ "$OCCUPIED" = "True" ]; then
  echo "❌ Cancelled slot is still shown as available"
  exit 1
fi
echo "✅ Cancelled slot is no longer in available slots"

echo ""
echo "=== CANCEL E2E TESTS PASSED ==="
echo "Booking ID: $BOOKING_ID"
echo "Clean up cancelled booking from Supabase if desired."
