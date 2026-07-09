#!/bin/bash
# E2E reschedule flow test
set -e

cd /home/petervarga/Documents/localup-homepage

pkill -f "astro dev" 2>/dev/null || true
sleep 1
rm -f reschedule-e2e.log

timeout 90 ./node_modules/.bin/astro dev --host 0.0.0.0 > reschedule-e2e.log 2>&1 &
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

# Find a different slot
SECOND_SLOT=$(echo "$SLOTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for day in data.get('slots', []):
    for s in day.get('slots', []):
        if s['start'] != '$SLOT_START':
            print(json.dumps(s))
            exit()
")
NEW_SLOT_START=$(echo "$SECOND_SLOT" | python3 -c "import sys,json; print(json.load(sys.stdin)['start'])")
NEW_SLOT_END=$(echo "$SECOND_SLOT" | python3 -c "import sys,json; print(json.load(sys.stdin)['end'])")

BOOKING_RES=$(curl -s -X POST http://localhost:4321/api/audit/book \
  -H "Content-Type: application/json" \
  -d "{
    \"businessName\": \"Reschedule E2E Business\",
    \"noWebsite\": true,
    \"city\": \"Budapest\",
    \"businessType\": \"Other local service\",
    \"goals\": [\"more_visibility\"],
    \"name\": \"Reschedule E2E User\",
    \"email\": \"peter@localup.hu\",
    \"slotStart\": \"$SLOT_START\",
    \"slotEnd\": \"$SLOT_END\"
  }")
echo "$BOOKING_RES"

BOOKING_ID=$(echo "$BOOKING_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('bookingId',''))")
if [ -z "$BOOKING_ID" ]; then
  echo "❌ No booking ID returned"
  exit 1
fi
TOKEN=$(npx tsx get-test-token.ts "$BOOKING_ID")
echo "✅ Booking created: $BOOKING_ID"

echo ""
echo "=== 2. Reschedule to new slot ==="
RESCHEDULE_RES=$(curl -s -X POST http://localhost:4321/api/audit/reschedule \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"expectedOldSlotStart\":\"$SLOT_START\",\"newSlotStart\":\"$NEW_SLOT_START\"}")
echo "$RESCHEDULE_RES"
if [[ $(echo "$RESCHEDULE_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))") != "True" ]]; then
  echo "❌ Reschedule failed"
  exit 1
fi
echo "✅ Reschedule succeeded"

echo ""
echo "=== 3. Idempotent reschedule to same slot ==="
RESCHEDULE2_RES=$(curl -s -X POST http://localhost:4321/api/audit/reschedule \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"expectedOldSlotStart\":\"$NEW_SLOT_START\",\"newSlotStart\":\"$NEW_SLOT_START\"}")
echo "$RESCHEDULE2_RES"
if [[ $(echo "$RESCHEDULE2_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('idempotent'))") != "True" ]]; then
  echo "❌ Same-slot reschedule did not return idempotent=true"
  exit 1
fi
echo "✅ Idempotent reschedule succeeded"

echo ""
echo "=== 4. Stale expectedOldSlotStart returns 409 ==="
STALE_RES=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4321/api/audit/reschedule \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"expectedOldSlotStart\":\"$SLOT_START\",\"newSlotStart\":\"$NEW_SLOT_START\"}")
if [ "$STALE_RES" != "409" ]; then
  echo "❌ Expected 409 for stale expectedOldSlotStart, got $STALE_RES"
  exit 1
fi
echo "✅ Stale expectedOldSlotStart returns 409"

echo ""
echo "=== RESCHEDULE E2E TESTS PASSED ==="
echo "Booking ID: $BOOKING_ID"
