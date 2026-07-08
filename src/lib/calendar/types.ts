// ============================================================
// Calendar provider types — provider-agnostic interface
// Supabase is the source of truth. Calendar is a sync target.
// ============================================================

/** A busy time range returned by a calendar provider */
export interface BusySlot {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

/** Parameters for creating a calendar event */
export interface CreateEventParams {
  summary: string;
  description: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  attendeeEmail?: string;
}

/**
 * Discriminated union for event creation results.
 * Use `result.ok` to distinguish success from failure.
 */
export type CreateEventResult =
  | {
      ok: true;
      provider: string;
      eventId: string;
      /** URL to the event in the provider's UI (optional) */
      htmlLink?: string;
      /** URL to the video conference (e.g. Google Meet), if created */
      meetLink?: string;
    }
  | {
      ok: false;
      provider: string;
      error: string;
      /** Machine-readable error code */
      code?: string;
    };

/**
 * Calendar provider interface.
 * Implementations: Google, Outlook, CalDAV, ICS feed, etc.
 *
 * Note: not all providers support both availability checking AND
 * event creation. A provider may only appear in syncProviders but
 * not availabilityProviders (e.g. ICS feed is sync-only, can't read
 * free/busy from it).
 */
export interface CalendarProvider {
  /** Unique provider identifier, e.g. 'google', 'outlook' */
  readonly id: string;
  /** Human-readable name for logging and UI */
  readonly name: string;

  /**
   * Whether this provider supports availability/freeBusy queries.
   * If false, getFreeBusy() will never be called on it.
   */
  readonly supportsAvailability: boolean;
  /**
   * Whether this provider supports event creation/sync.
   * If false, createEvent() will never be called on it.
   */
  readonly supportsSync: boolean;

  /** Check busy/free slots in a time range */
  getFreeBusy?(timeMin: string, timeMax: string): Promise<BusySlot[]>;

  /** Create a calendar event */
  createEvent?(params: CreateEventParams): Promise<CreateEventResult>;
}

/**
 * Result of syncing a booking to a single calendar provider.
 */
export interface ProviderSyncResult {
  provider: string;
  status: 'synced' | 'failed';
  providerEventId?: string;
  error?: string;
}

/**
 * Summary of syncing a booking across all configured providers.
 */
export interface CalendarSyncOutcome {
  results: ProviderSyncResult[];
  /** First successful provider event ID (for backward compat) */
  primaryEventId: string | null;
  /**
   * Overall sync status:
   * - synced: all providers succeeded
   * - partially_synced: at least one succeeded, one failed
   * - failed: no provider succeeded
   * - not_configured: no providers are active
   */
  overallStatus: 'synced' | 'partially_synced' | 'failed' | 'not_configured';
}
