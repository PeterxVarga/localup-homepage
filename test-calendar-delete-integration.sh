#!/bin/bash
# Integration test: booking cancel must delete the Google Calendar event.
set -e

cd /home/petervarga/Documents/localup-homepage

pkill -f "astro dev" 2>/dev/null || true
sleep 1
rm -f calendar-delete-integration.log

timeout 120 ./node_modules/.bin/astro dev --host 0.0.0.0 > calendar-delete-integration.log 2>&1 &
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
    \"businessName\": \"Calendar Delete Integration Test\",
    \"noWebsite\": true,
    \"city\": \"Budapest\",
    \"businessType\": \"Other local service\",
    \"goals\": [\"more_visibility\"],
    \"name\": \"Calendar Delete Test User\",
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
echo "=== 2. Read event ID from Supabase ==="
echo "$BOOKING_ID" > /tmp/calendar_delete_booking_id.txt

EVENT_ID=$(npx tsx - << 'EOF'
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
const bookingId = fs.readFileSync('/tmp/calendar_delete_booking_id.txt', 'utf8').trim();
const { data } = await supabase.from('audit_bookings').select('google_calendar_event_id').eq('id', bookingId).single();
console.log(data?.google_calendar_event_id || '');
EOF
)

if [ -z "$EVENT_ID" ]; then
  echo "❌ No Google Calendar event ID found in Supabase"
  exit 1
fi
echo "✅ Event ID: $EVENT_ID"

echo ""
echo "=== 3. Cancel the booking ==="
TOKEN=$(npx tsx get-test-token.ts "$BOOKING_ID")
CANCEL_RES=$(curl -s -X POST http://localhost:4321/api/audit/cancel \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}")
echo "$CANCEL_RES"
if [[ $(echo "$CANCEL_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))") != "True" ]]; then
  echo "❌ Cancel failed"
  exit 1
fi
if [[ $(echo "$CANCEL_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('calendarDeleted'))") != "True" ]]; then
  echo "❌ Calendar was not marked as deleted"
  exit 1
fi
echo "✅ Cancel succeeded and calendarDeleted=true"

echo ""
echo "=== 4. Verify calendar_sync_status=synced in Supabase ==="
echo "$BOOKING_ID" > /tmp/calendar_delete_booking_id.txt

SYNC_STATUS=$(npx tsx - << 'EOF'
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
const bookingId = fs.readFileSync('/tmp/calendar_delete_booking_id.txt', 'utf8').trim();
const { data } = await supabase.from('audit_bookings').select('calendar_sync_status').eq('id', bookingId).single();
console.log(data?.calendar_sync_status || '');
EOF
)

if [ "$SYNC_STATUS" != "synced" ]; then
  echo "❌ Expected calendar_sync_status=synced, got $SYNC_STATUS"
  exit 1
fi
echo "✅ calendar_sync_status=synced"

echo ""
echo "=== 5. Verify Google Calendar event no longer exists ==="
echo "$EVENT_ID" > /tmp/calendar_delete_event_id.txt

EXISTS=$(npx tsx - << 'EOF'
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
const { googleCalendarProvider } = await import('./src/lib/calendar/provider/google.ts');
const eventId = fs.readFileSync('/tmp/calendar_delete_event_id.txt', 'utf8').trim();

for (let attempt = 1; attempt <= 3; attempt++) {
  const result = await googleCalendarProvider.getEvent!(eventId);
  if (!result.ok) {
    console.log('false');
    process.exit(0);
  }
  console.log(`Attempt ${attempt}: event still visible via events.get, retrying...`);
  if (attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
console.log('true');
EOF
)

if [ "$EXISTS" = "true" ]; then
  echo "❌ Calendar event still exists after cancellation"
  exit 1
fi
echo "✅ Calendar event deleted"

echo ""
echo "=== CALENDAR DELETE INTEGRATION TEST PASSED ==="
echo "Booking ID: $BOOKING_ID"
echo "Event ID: $EVENT_ID"
