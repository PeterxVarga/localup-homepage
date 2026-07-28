// ============================================================
// Public quote request validation
//
// Strict schema: the client may only submit option IDs.
// Prices, durations, labels, modes, and currencies are always resolved
// server-side and rejected here.
// ============================================================

import { z } from 'zod';

export const quoteRequestSchema = z
  .object({
    optionIds: z
      .array(z.uuid({ message: 'Each optionId must be a valid UUID' }))
      .max(20, 'optionIds must contain at most 20 items'),
  })
  .strict();

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
