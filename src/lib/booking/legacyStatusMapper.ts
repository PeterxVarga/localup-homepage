// ============================================================
// Legacy status mapper
// Isolated compatibility adapter that writes the old `status` column
// from the new `calendar_sync_status` value.
//
// This is the ONLY place in the application that references the legacy
// `status` column for writes. It must be removed together with the column
// in Phase B (006_booking_status_contract.sql).
//
// Mapping:
//   calendar_sync_status = 'pending' -> status = 'calendar_pending'
//   calendar_sync_status = 'synced'  -> status = 'booked'
//   calendar_sync_status = 'failed'  -> status = 'calendar_failed'
//
// Cancelled bookings keep booking_status = 'cancelled' as the source of
// truth; the legacy status remains at the last calendar sync state.
// ============================================================

export type LegacyStatus = 'calendar_pending' | 'booked' | 'calendar_failed';

export function toLegacyStatus(
  calendarSyncStatus: 'pending' | 'synced' | 'failed',
): LegacyStatus {
  switch (calendarSyncStatus) {
    case 'pending':
      return 'calendar_pending';
    case 'synced':
      return 'booked';
    case 'failed':
      return 'calendar_failed';
  }
}
