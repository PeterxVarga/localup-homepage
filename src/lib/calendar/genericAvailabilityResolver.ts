// ============================================================
// Generic availability resolver — pure tenant-isolated logic
//
// No external dependencies. The wiring with Supabase, Google and crypto
// lives in genericAvailabilityProvider.ts.
// ============================================================

export interface CalendarConfig {
  id: string;
  siteId: string;
  provider: string;
  calendarId: string;
  encryptedRefreshToken: string;
}

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

export interface ResolverDependencies {
  loadConfigs(siteId: string): Promise<CalendarConfig[]>;
  buildProvider(config: CalendarConfig): Promise<GenericAvailabilityProvider>;
}

/**
 * Resolve the availability provider for a generic (non-audit) booking site.
 *
 * Fail-closed:
 *   - no active config            -> provider_unconfigured
 *   - ambiguous active config     -> provider_ambiguous
 *   - buildProvider throws        -> propagated as-is
 */
export async function resolveGenericAvailabilityProvider(
  siteId: string,
  siteSlug: string,
  deps: ResolverDependencies,
): Promise<GenericAvailabilityProvider> {
  const configs = await deps.loadConfigs(siteId);

  if (configs.length === 0) {
    throw new GenericAvailabilityProviderError(
      `Generic availability provider is not configured for site ${siteSlug}`,
      'provider_unconfigured',
    );
  }

  if (configs.length > 1) {
    throw new GenericAvailabilityProviderError(
      `Multiple active availability providers found for site ${siteSlug}`,
      'provider_ambiguous',
    );
  }

  return deps.buildProvider(configs[0]);
}

/**
 * Bind a provider's getFreeBusy method to a callback that preserves `this`.
 * Avoids passing `provider.getFreeBusy` directly as a higher-order function.
 */
export function bindGetFreeBusy(
  provider: GenericAvailabilityProvider,
): (timeMin: string, timeMax: string) => Promise<Array<{ start: string; end: string }>> {
  return (timeMin, timeMax) => provider.getFreeBusy(timeMin, timeMax);
}
