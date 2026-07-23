// ============================================================
// Generic availability provider resolver — tenant-isolated
//
// The generic public booking API must not reuse the global LocalUp Google
// Calendar provider for arbitrary tenants. This module provides the resolver
// interface; in this slice no generic site is configured, so it fail-closed.
//
// The next Cosmetics integration slice will add site-specific calendar config
// (OAuth credentials, calendar IDs, etc.) behind this resolver.
// ============================================================

export interface GenericAvailabilityProvider {
  getFreeBusy(
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{ start: string; end: string }>>;
}

export class GenericAvailabilityProviderError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'GenericAvailabilityProviderError';
    this.code = code;
  }
}

/**
 * Resolve the availability provider for a generic (non-audit) booking site.
 *
 * Fail-closed: until site-specific calendar configuration is implemented,
 * every request is rejected with `provider_unconfigured`. The generic API is
 * also gated by `public_booking_enabled` on the booking service, so in normal
 * operation this code path is never reached.
 */
export async function resolveGenericAvailabilityProvider(
  siteId: string,
  siteSlug: string,
): Promise<GenericAvailabilityProvider> {
  throw new GenericAvailabilityProviderError(
    `Generic availability provider is not configured for site ${siteSlug} (${siteId})`,
    'provider_unconfigured',
  );
}
