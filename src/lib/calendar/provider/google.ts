// ============================================================
// Google Calendar provider — implements CalendarProvider
// Supports both availability (freeBusy) and sync (event creation)
// ============================================================

import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import type {
  CalendarProvider,
  BusySlot,
  CreateEventParams,
  CreateEventResult,
} from '../types';
import { env } from '../../env';

export function isGoogleCalendarConfigured(): boolean {
  return !!(env.googleClientId && env.googleClientSecret && env.googleRefreshToken);
}

/**
 * Lazily create the Google OAuth2 + Calendar client.
 * We only instantiate this when a calendar call is actually made and
 * all credentials are present. No half-configured global client.
 */
export function getGoogleCalendarClient(): { calendar: calendar_v3.Calendar; calendarId: string } {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('Google Calendar is not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
  );

  oauth2Client.setCredentials({
    refresh_token: env.googleRefreshToken,
  });

  return {
    calendar: google.calendar({ version: 'v3', auth: oauth2Client }),
    calendarId: env.googleCalendarId,
  };
}

// --- Provider implementation ---

export const googleCalendarProvider: CalendarProvider = {
  id: 'google',
  name: 'Google Calendar',
  supportsAvailability: true,
  supportsSync: true,

  async getFreeBusy(timeMin: string, timeMax: string): Promise<BusySlot[]> {
    if (!isGoogleCalendarConfigured()) {
      console.warn('Google Calendar not configured — skipping freeBusy check');
      return [];
    }

    try {
      const { calendar, calendarId } = getGoogleCalendarClient();
      const res = await calendar.freebusy.query({
        requestBody: { timeMin, timeMax, items: [{ id: calendarId }] },
      });

      return (res.data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
        start: b.start ?? '',
        end: b.end ?? '',
      }));
    } catch (err) {
      console.error('Google freeBusy query failed:', err);
      return [];
    }
  },

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    if (!isGoogleCalendarConfigured()) {
      return {
        ok: false,
        provider: 'google',
        error: 'Google Calendar not configured',
        code: 'not_configured',
      };
    }

    try {
      const { calendar, calendarId } = getGoogleCalendarClient();
      const event = await calendar.events.insert({
        calendarId,
        conferenceDataVersion: 1,
        requestBody: {
          summary: params.summary,
          description: params.description,
          start: { dateTime: params.start, timeZone: 'Europe/Budapest' },
          end: { dateTime: params.end, timeZone: 'Europe/Budapest' },
          attendees: params.attendeeEmail
            ? [{ email: params.attendeeEmail }]
            : undefined,
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 24 * 60 },
              { method: 'popup', minutes: 30 },
            ],
          },
        },
      });

      return {
        ok: true,
        provider: 'google',
        eventId: event.data.id ?? '',
        htmlLink: event.data.htmlLink ?? undefined,
        meetLink: event.data.hangoutLink ?? undefined,
      };
    } catch (err) {
      console.error('Google Calendar event creation failed:', err);
      return {
        ok: false,
        provider: 'google',
        error: 'Google Calendar API error',
        code: 'calendar_api_error',
      };
    }
  },

  async patchEvent(eventId: string, params: import('../types').PatchEventParams) {
    if (!isGoogleCalendarConfigured()) {
      return {
        ok: false,
        provider: 'google',
        eventId,
        error: 'Google Calendar not configured',
        code: 'not_configured',
      } as const;
    }

    try {
      const { calendar, calendarId } = getGoogleCalendarClient();
      const event = await calendar.events.patch({
        calendarId,
        eventId,
        sendUpdates: 'none',
        requestBody: {
          start: { dateTime: params.start, timeZone: 'Europe/Budapest' },
          end: { dateTime: params.end, timeZone: 'Europe/Budapest' },
        },
      });

      return {
        ok: true as const,
        provider: 'google',
        eventId: event.data.id ?? eventId,
        htmlLink: event.data.htmlLink ?? undefined,
        meetLink: event.data.hangoutLink ?? undefined,
      };
    } catch (err) {
      console.error('Google Calendar event patch failed:', err);
      return {
        ok: false,
        provider: 'google',
        eventId,
        error: 'Google Calendar API error',
        code: 'calendar_api_error',
      } as const;
    }
  },

  async getEvent(eventId: string) {
    if (!isGoogleCalendarConfigured()) {
      return {
        ok: false,
        provider: 'google',
        eventId,
        error: 'Google Calendar not configured',
        code: 'not_configured',
      } as const;
    }

    try {
      const { calendar, calendarId } = getGoogleCalendarClient();
      const event = await calendar.events.get({ calendarId, eventId });

      return {
        ok: true as const,
        provider: 'google',
        eventId: event.data.id ?? eventId,
        start: event.data.start?.dateTime ?? undefined,
        end: event.data.end?.dateTime ?? undefined,
        meetLink: event.data.hangoutLink ?? undefined,
      };
    } catch (err) {
      console.error('Google Calendar event get failed:', err);
      return {
        ok: false,
        provider: 'google',
        eventId,
        error: 'Google Calendar API error',
        code: 'calendar_api_error',
      } as const;
    }
  },

  async deleteEvent(eventId: string) {
    if (!isGoogleCalendarConfigured()) {
      return {
        ok: false,
        provider: 'google',
        eventId,
        error: 'Google Calendar not configured',
        code: 'not_configured',
      } as const;
    }

    try {
      const { calendar, calendarId } = getGoogleCalendarClient();
      await calendar.events.delete({ calendarId, eventId });

      return {
        ok: true as const,
        provider: 'google',
        eventId,
      };
    } catch (err) {
      console.error('Google Calendar event deletion failed:', err);
      return {
        ok: false,
        provider: 'google',
        eventId,
        error: 'Google Calendar API error',
        code: 'calendar_api_error',
      } as const;
    }
  },
} satisfies CalendarProvider & {
  deleteEvent: NonNullable<CalendarProvider['deleteEvent']>;
  patchEvent: NonNullable<CalendarProvider['patchEvent']>;
};
