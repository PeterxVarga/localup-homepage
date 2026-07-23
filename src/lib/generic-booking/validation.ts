// ============================================================
// Generic booking — request validation
//
// Strict schema: the client may only submit the fields below.
// Server-side identity (siteId, serviceId) and service configuration
// (duration, buffer, status fields) are resolved and enforced by the
// backend and are rejected here.
// ============================================================

import { z } from 'zod';

const SUPPORTED_LOCALES = ['hu', 'en'] as const;

export const genericBookingRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name must be at most 120 characters'),
    email: z
      .string()
      .trim()
      .email('Please enter a valid email address')
      .max(254, 'Email must be at most 254 characters'),
    phone: z
      .string()
      .trim()
      .max(40, 'Phone must be at most 40 characters')
      .optional(),
    notes: z
      .string()
      .trim()
      .max(2000, 'Notes must be at most 2000 characters')
      .optional(),
    slotStart: z.string().datetime({
      message: 'Slot start must be a valid ISO datetime with offset',
      offset: true,
    }),
    slotEnd: z.string().datetime({
      message: 'Slot end must be a valid ISO datetime with offset',
      offset: true,
    }),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
    honeypot: z.string().max(200).optional(),
  })
  .strict();

export type GenericBookingRequest = z.infer<typeof genericBookingRequestSchema>;
