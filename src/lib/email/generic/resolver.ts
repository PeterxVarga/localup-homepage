// ============================================================
// Generic booking email resolver — tenant-aware fail-closed wiring
//
// Loads the single active site_email_configs row for a site.
// The global env.emailFrom is still the actual sender address (Resend
// verified domain), but tenant branding, reply-to, admin address and
// management URLs come from the tenant config.
// ============================================================

import { getSupabase } from '../../supabase';
import type { SiteEmailConfig } from './types';

export class GenericEmailResolverError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'GenericEmailResolverError';
    this.code = code;
  }
}

interface SiteEmailConfigRow {
  id: string;
  site_id: string;
  display_name: string;
  notification_email: string;
  reply_to_email: string;
  site_url: string;
  locale: string;
  is_active: boolean;
}

function isValidEmail(email: string): boolean {
  // Lenient RFC-like check: require at least one @ and a domain dot.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidLocale(locale: string): locale is 'hu' | 'en' {
  return locale === 'hu' || locale === 'en';
}

function mapRow(row: SiteEmailConfigRow): SiteEmailConfig {
  return {
    id: row.id,
    siteId: row.site_id,
    displayName: row.display_name.trim(),
    notificationEmail: row.notification_email.trim(),
    replyToEmail: row.reply_to_email.trim(),
    siteUrl: row.site_url.trim().replace(/\/$/, ''),
    locale: isValidLocale(row.locale) ? row.locale : 'hu',
    isActive: row.is_active,
  };
}

function validateConfig(config: SiteEmailConfig): void {
  if (config.displayName === '') {
    throw new GenericEmailResolverError(
      'Tenant email display name is empty',
      'email_invalid_config',
    );
  }

  if (!isValidEmail(config.notificationEmail)) {
    throw new GenericEmailResolverError(
      'Tenant notification email is invalid',
      'email_invalid_config',
    );
  }

  if (!isValidEmail(config.replyToEmail)) {
    throw new GenericEmailResolverError(
      'Tenant reply-to email is invalid',
      'email_invalid_config',
    );
  }

  if (!isValidHttpsUrl(config.siteUrl)) {
    throw new GenericEmailResolverError(
      'Tenant site URL is not a valid HTTPS URL',
      'email_invalid_config',
    );
  }

  if (!isValidLocale(config.locale)) {
    throw new GenericEmailResolverError(
      'Tenant locale is not supported',
      'email_invalid_config',
    );
  }
}

export interface ResolverDeps {
  loadConfigs(siteId: string): Promise<SiteEmailConfigRow[]>;
}

export async function resolveSiteEmailConfig(
  siteId: string,
  deps?: Partial<ResolverDeps>,
): Promise<SiteEmailConfig> {
  const loadConfigs =
    deps?.loadConfigs ??
    (async (id: string) => {
      const { data, error } = await getSupabase()
        .from('site_email_configs')
        .select(
          'id, site_id, display_name, notification_email, reply_to_email, site_url, locale, is_active',
        )
        .eq('site_id', id)
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      return (data ?? []) as SiteEmailConfigRow[];
    });

  let rows: SiteEmailConfigRow[];
  try {
    rows = await loadConfigs(siteId);
  } catch (error) {
    console.error('Failed to load site email config');
    throw new GenericEmailResolverError(
      'Failed to load tenant email configuration',
      'email_lookup_failed',
    );
  }

  if (rows.length === 0) {
    throw new GenericEmailResolverError(
      `Tenant email is not configured for site ${siteId}`,
      'email_unconfigured',
    );
  }

  if (rows.length > 1) {
    throw new GenericEmailResolverError(
      `Multiple active email configs found for site ${siteId}`,
      'email_ambiguous',
    );
  }

  const config = mapRow(rows[0]);
  validateConfig(config);
  return config;
}
