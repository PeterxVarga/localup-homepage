// ============================================================
// Availability read model — server-side service-role access only
// ============================================================

import { getSupabase } from '../supabase';
import {
  type AvailabilityBundle,
  type AvailabilityDateOverride,
  type AvailabilityDateOverrideInterval,
  type AvailabilityOverrideKind,
  type AvailabilitySchedule,
  type AvailabilityWeeklyRule,
  type IsoWeekday,
} from './types';

const SCHEDULE_FIELDS = [
  'id',
  'site_id',
  'name',
  'timezone',
  'is_default',
  'is_active',
].join(',');

const WEEKLY_RULE_FIELDS = [
  'id',
  'schedule_id',
  'weekday',
  'start_time',
  'end_time',
  'sort_order',
].join(',');

const DATE_OVERRIDE_FIELDS = [
  'id',
  'schedule_id',
  'override_date',
  'kind',
  'reason',
].join(',');

const DATE_OVERRIDE_INTERVAL_FIELDS = [
  'id',
  'override_id',
  'start_time',
  'end_time',
  'sort_order',
].join(',');

interface ScheduleRow {
  id: string;
  site_id: string;
  name: string;
  timezone: string;
  is_default: boolean;
  is_active: boolean;
}

interface WeeklyRuleRow {
  id: string;
  schedule_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  sort_order: number;
}

interface DateOverrideRow {
  id: string;
  schedule_id: string;
  override_date: string;
  kind: string;
  reason: string | null;
}

interface DateOverrideIntervalRow {
  id: string;
  override_id: string;
  start_time: string;
  end_time: string;
  sort_order: number;
}

export class AvailabilityQueryError extends Error {
  readonly code: string;

  constructor(message: string, code = 'availability_query_failed') {
    super(message);
    this.name = 'AvailabilityQueryError';
    this.code = code;
  }
}

function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

function mapSchedule(row: ScheduleRow): AvailabilitySchedule {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    timezone: row.timezone,
    isDefault: row.is_default,
    isActive: row.is_active,
  };
}

function mapWeeklyRule(row: WeeklyRuleRow): AvailabilityWeeklyRule {
  if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) {
    throw new AvailabilityQueryError(
      `Invalid availability weekday: ${row.weekday}`,
      'invalid_weekday',
    );
  }

  return {
    id: row.id,
    scheduleId: row.schedule_id,
    weekday: row.weekday as IsoWeekday,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    sortOrder: row.sort_order,
  };
}

function mapInterval(
  row: DateOverrideIntervalRow,
): AvailabilityDateOverrideInterval {
  return {
    id: row.id,
    overrideId: row.override_id,
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    sortOrder: row.sort_order,
  };
}

function isOverrideKind(value: string): value is AvailabilityOverrideKind {
  return value === 'unavailable' || value === 'custom';
}

export async function getAvailabilitySchedule(
  scheduleId: string,
): Promise<AvailabilitySchedule> {
  const { data, error } = await getSupabase()
    .from('availability_schedules')
    .select(SCHEDULE_FIELDS)
    .eq('id', scheduleId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new AvailabilityQueryError('Failed to load availability schedule');
  }
  if (!data) {
    throw new AvailabilityQueryError(
      'Availability schedule is missing',
      'schedule_not_found',
    );
  }

  return mapSchedule(data as unknown as ScheduleRow);
}

export async function getAvailabilityWeeklyRules(
  scheduleId: string,
): Promise<AvailabilityWeeklyRule[]> {
  const { data, error } = await getSupabase()
    .from('availability_weekly_rules')
    .select(WEEKLY_RULE_FIELDS)
    .eq('schedule_id', scheduleId)
    .order('weekday', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    throw new AvailabilityQueryError(
      'Failed to load weekly availability rules',
    );
  }

  return ((data ?? []) as unknown as WeeklyRuleRow[]).map(mapWeeklyRule);
}

export async function getAvailabilityDateOverrides(
  scheduleId: string,
  dateFrom: string,
  dateTo: string,
): Promise<AvailabilityDateOverride[]> {
  const { data: overrideData, error: overrideError } = await getSupabase()
    .from('availability_date_overrides')
    .select(DATE_OVERRIDE_FIELDS)
    .eq('schedule_id', scheduleId)
    .gte('override_date', dateFrom)
    .lte('override_date', dateTo)
    .order('override_date', { ascending: true });

  if (overrideError) {
    throw new AvailabilityQueryError('Failed to load availability overrides');
  }

  const rows = (overrideData ?? []) as unknown as DateOverrideRow[];
  if (rows.length === 0) return [];

  const overrideIds = rows.map((row) => row.id);
  const { data: intervalData, error: intervalError } = await getSupabase()
    .from('availability_date_override_intervals')
    .select(DATE_OVERRIDE_INTERVAL_FIELDS)
    .in('override_id', overrideIds)
    .order('sort_order', { ascending: true })
    .order('start_time', { ascending: true });

  if (intervalError) {
    throw new AvailabilityQueryError(
      'Failed to load availability override intervals',
    );
  }

  const intervalsByOverride = new Map<
    string,
    AvailabilityDateOverrideInterval[]
  >();
  for (const row of (intervalData ??
    []) as unknown as DateOverrideIntervalRow[]) {
    const intervals = intervalsByOverride.get(row.override_id) ?? [];
    intervals.push(mapInterval(row));
    intervalsByOverride.set(row.override_id, intervals);
  }

  return rows.map((row) => {
    if (!isOverrideKind(row.kind)) {
      throw new AvailabilityQueryError(
        `Invalid availability override kind: ${row.kind}`,
        'invalid_override_kind',
      );
    }

    return {
      id: row.id,
      scheduleId: row.schedule_id,
      overrideDate: row.override_date,
      kind: row.kind,
      reason: row.reason,
      intervals: intervalsByOverride.get(row.id) ?? [],
    };
  });
}

export async function getAvailabilityBundle(
  scheduleId: string,
  dateFrom: string,
  dateTo: string,
): Promise<AvailabilityBundle> {
  const [schedule, weeklyRules, dateOverrides] = await Promise.all([
    getAvailabilitySchedule(scheduleId),
    getAvailabilityWeeklyRules(scheduleId),
    getAvailabilityDateOverrides(scheduleId, dateFrom, dateTo),
  ]);

  return { schedule, weeklyRules, dateOverrides };
}
