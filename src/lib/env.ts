// ============================================================
// Server-only environment access
// ============================================================
//
// Single source of truth for all server-side env vars.
//
// We resolve each variable from `process.env` first and fall back to
// `import.meta.env`. `process.env` is the runtime truth when the app runs
// as a `@astrojs/node` standalone server, so credentials can be swapped
// (e.g. staging → production) by restarting the process WITHOUT a rebuild.
//
// This was empirically verified against `astro build` + `@astrojs/node`
// standalone mode: see docs/env-runtime-verification.md
//
// Client components MUST NOT import this module.
//

function read(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;

  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  if (importMetaEnv !== undefined) {
    const fromImport = importMetaEnv[name];
    if (fromImport !== undefined && fromImport !== '') return fromImport;
  }

  return undefined;
}

export const env = {
  // Supabase
  supabaseUrl: read('SUPABASE_URL'),
  supabaseServiceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY'),

  // Google Calendar OAuth
  googleClientId: read('GOOGLE_CLIENT_ID'),
  googleClientSecret: read('GOOGLE_CLIENT_SECRET'),
  googleRefreshToken: read('GOOGLE_REFRESH_TOKEN'),
  googleCalendarId: read('GOOGLE_CALENDAR_ID') ?? 'primary',

  // Resend
  resendApiKey: read('RESEND_API_KEY'),

  // Site / admin
  adminEmail: read('ADMIN_EMAIL') ?? 'admin@localup.io',
  siteUrl: read('SITE_URL') ?? 'http://localhost:4321',

  // Email sender identity
  emailFrom: read('EMAIL_FROM') ?? 'LocalUp <hello@localup.hu>',
  emailReplyTo: read('EMAIL_REPLY_TO') ?? 'peter@localup.hu',

  // Booking management token encryption (32 bytes as 64 hex chars)
  bookingTokenEncryptionKey: read('BOOKING_TOKEN_ENCRYPTION_KEY'),

  // Cancel / reschedule cutoff hours
  auditCancelCutoffHours: parseInt(read('AUDIT_CANCEL_CUTOFF_HOURS') ?? '12', 10),
  auditRescheduleCutoffHours: parseInt(read('AUDIT_RESCHEDULE_CUTOFF_HOURS') ?? '12', 10),
  auditMaxReschedules: parseInt(read('AUDIT_MAX_RESCHEDULES') ?? '2', 10),

  // Reminder cron secret (must match Supabase Vault secret 'reminder_cron_secret')
  reminderCronSecret: read('REMINDER_CRON_SECRET'),
};

/**
 * Absolute site URL without trailing slash.
 * Used for email links, tracking sourceUrl, and future cancel/reschedule URLs.
 */
export function siteUrl(): string {
  return env.siteUrl.replace(/\/$/, '');
}
