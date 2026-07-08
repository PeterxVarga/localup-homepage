// ============================================================
// Audit booking config & constants
// Framework-neutral — usable from Astro, Next.js, or any runtime
// ============================================================

export const availabilityConfig = {
  /** Source timezone for availability windows */
  timezone: 'Europe/Budapest',
  /** Duration of each bookable slot in minutes */
  slotDurationMinutes: 30,
  /** Buffer between slots in minutes */
  bufferMinutes: 15,
  /** Minimum hours before a slot can be booked */
  minAdvanceHours: 24,
  /** Maximum days ahead to generate slots for */
  maxAdvanceDays: 14,

  /** Weekly availability schedule (1=Monday … 0=Sunday) */
  weeklySchedule: [
    { weekday: 1, start: '10:00', end: '12:00' }, // Monday
    { weekday: 2, start: '14:00', end: '17:00' }, // Tuesday
    { weekday: 4, start: '10:00', end: '15:00' }, // Thursday
  ],
} as const;

export const businessTypes = [
  'Home services (plumbing, HVAC, electrical, cleaning)',
  'Construction & trades (roofing, contracting, landscaping)',
  'Health & wellness (dentist, medical, therapy, fitness)',
  'Beauty & personal care (salon, barber, spa)',
  'Professional services (legal, real estate, tutoring)',
  'Automotive (repair, body shop, detailing)',
  'Pet services (grooming, veterinary, daycare)',
  'Other local service',
] as const;

export const goalOptions = [
  { id: 'more_visibility', label: 'More local visibility' },
  { id: 'more_calls', label: 'More calls / bookings' },
  { id: 'better_website', label: 'Better website' },
  { id: 'more_reviews', label: 'More reviews' },
  { id: 'not_sure', label: 'Not sure yet' },
] as const;

export type BusinessType = (typeof businessTypes)[number];
export type GoalId = (typeof goalOptions)[number]['id'];
