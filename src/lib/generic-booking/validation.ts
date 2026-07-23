// ============================================================
// Generic booking — request validation
//
// Strict schema: the client may only submit the fields below.
// Server-side identity (siteId, serviceId) and service configuration
// (duration, buffer, status fields) are resolved and enforced by the
// backend and are rejected here.
// ============================================================

import { z } from 'zod';

export const genericBookingRequestSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Please enter a valid email address'),
    phone: z.string().optional(),
    notes: z.string().optional(),
    slotStart: z.string().min(1, 'Slot start is required'),
    slotEnd: z.string().min(1, 'Slot end is required'),
    locale: z.string().optional(),
    honeypot: z.string().optional(),
  })
  .strict();

export type GenericBookingRequest = z.infer<typeof genericBookingRequestSchema>;
