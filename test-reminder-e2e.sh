#!/bin/bash
# E2E reminder lifecycle test
# Requires migration 007_booking_notifications.sql to be applied.
set -e

cd /home/petervarga/Documents/localup-homepage

pkill -f "astro dev" 2>/dev/null || true
sleep 1
rm -f reminder-e2e.log

timeout 120 ./node_modules/.bin/astro dev --host 0.0.0.0 > reminder-e2e.log 2>&1 &
SERVER_PID=$!
sleep 6

cleanup_server() {
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup_server EXIT

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
    \"businessName\": \"Reminder E2E Business\",
    \"noWebsite\": true,
    \"city\": \"Budapest\",
    \"businessType\": \"Other local service\",
    \"goals\": [\"more_visibility\"],
    \"name\": \"Reminder E2E User\",
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
echo "✅ Booking created: $BOOKING_ID"

echo ""
echo "=== 2. Verify reminders were created ==="
echo "$BOOKING_ID" > /tmp/reminder_e2e_booking_id.txt

REMINDER_COUNT=$(npx tsx - << 'EOF'
import fs from 'fs';
const envFile = fs.readFileSync('.env', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx);
  const value = trimmed.slice(idx + 1).trim();
  if (process.env[key] === undefined) process.env[key] = value;
}
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const bookingId = fs.readFileSync('/tmp/reminder_e2e_booking_id.txt', 'utf8').trim();
const { data, error } = await supabase.from('booking_notifications').select('id').eq('booking_id', bookingId);
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(data?.length ?? 0);
EOF
)

if [ "$REMINDER_COUNT" != "2" ]; then
  echo "❌ Expected 2 reminders, got $REMINDER_COUNT"
  exit 1
fi
echo "✅ 2 reminders created"

echo ""
echo "=== 3. Reschedule to a later slot ==="
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
TOKEN=$(npx tsx get-test-token.ts "$BOOKING_ID")
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
echo "=== 4. Verify old reminders cancelled, new reminders created ==="
REMINDER_STATUS=$(npx tsx - << 'EOF'
import fs from 'fs';
const envFile = fs.readFileSync('.env', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx);
  const value = trimmed.slice(idx + 1).trim();
  if (process.env[key] === undefined) process.env[key] = value;
}
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const bookingId = fs.readFileSync('/tmp/reminder_e2e_booking_id.txt', 'utf8').trim();
const { data, error } = await supabase.from('booking_notifications').select('notification_type, status, slot_version').eq('booking_id', bookingId).order('slot_version');
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(JSON.stringify(data));
EOF
)
echo "$REMINDER_STATUS"

CANCELLED_COUNT=$(echo "$REMINDER_STATUS" | python3 -c "import sys,json; print(sum(1 for r in json.load(sys.stdin) if r['status'] == 'cancelled'))")
PENDING_COUNT=$(echo "$REMINDER_STATUS" | python3 -c "import sys,json; print(sum(1 for r in json.load(sys.stdin) if r['status'] == 'pending'))")
SLOT_VERSION_1_COUNT=$(echo "$REMINDER_STATUS" | python3 -c "import sys,json; print(sum(1 for r in json.load(sys.stdin) if r['slot_version'] == 1))")

if [ "$CANCELLED_COUNT" != "2" ] || [ "$PENDING_COUNT" != "2" ] || [ "$SLOT_VERSION_1_COUNT" != "2" ]; then
  echo "❌ Expected 2 cancelled old reminders, 2 pending new reminders with slot_version=1"
  exit 1
fi
echo "✅ Old reminders cancelled, new reminders created for slot_version=1"

echo ""
echo "=== 5. Cancel the booking ==="
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
echo "=== 6. Verify all reminders cancelled ==="
FINAL_STATUS=$(npx tsx - << 'EOF'
import fs from 'fs';
const envFile = fs.readFileSync('.env', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx);
  const value = trimmed.slice(idx + 1).trim();
  if (process.env[key] === undefined) process.env[key] = value;
}
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const bookingId = fs.readFileSync('/tmp/reminder_e2e_booking_id.txt', 'utf8').trim();
const { data, error } = await supabase.from('booking_notifications').select('status').eq('booking_id', bookingId);
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(JSON.stringify(data));
EOF
)
echo "$FINAL_STATUS"

NON_CANCELLED=$(echo "$FINAL_STATUS" | python3 -c "import sys,json; print(sum(1 for r in json.load(sys.stdin) if r['status'] != 'cancelled'))")
if [ "$NON_CANCELLED" != "0" ]; then
  echo "❌ Expected all reminders cancelled, found non-cancelled: $NON_CANCELLED"
  exit 1
fi
echo "✅ All reminders cancelled"

echo ""
echo "=== REMINDER E2E TESTS PASSED ==="
echo "Booking ID: $BOOKING_ID"
