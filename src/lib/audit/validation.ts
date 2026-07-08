// ============================================================
// Zod validation schemas — shared between client preview & server
// ============================================================

import { z } from 'zod';

export const businessStepSchema = z
  .object({
    businessName: z.string().min(1, 'Business name is required'),
    websiteUrl: z
      .string()
      .url('Please enter a valid URL')
      .optional()
      .or(z.literal('')),
    noWebsite: z.boolean(),
    city: z.string().min(1, 'City or service area is required'),
    businessType: z.string().min(1, 'Please select your business type'),
  })
  .refine(
    (data) => data.noWebsite || (data.websiteUrl && data.websiteUrl.length > 0),
    {
      message:
        'Enter your website URL or select "I don\'t have a website"',
      path: ['websiteUrl'],
    },
  );

export const goalsStepSchema = z.object({
  goals: z.array(z.string()).min(1, 'Select at least one area to improve'),
  notes: z.string().optional(),
});

export const timeStepSchema = z.object({
  name: z.string().min(1, 'Your name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  slotStart: z.string().min(1, 'Please select a time slot'),
  slotEnd: z.string().min(1),
});

export const auditBookingSchema = z.object({
  businessName: z.string().min(1),
  websiteUrl: z.string().optional().or(z.literal('')),
  noWebsite: z.boolean(),
  city: z.string().min(1),
  businessType: z.string().min(1),
  goals: z.array(z.string()).min(1),
  notes: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  slotStart: z.string().min(1),
  slotEnd: z.string().min(1),
  ctaLocation: z.string().optional(),
  sourceUrl: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

export type AuditBookingInput = z.infer<typeof auditBookingSchema>;
