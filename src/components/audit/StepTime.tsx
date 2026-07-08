// ============================================================
// StepTime — Step 3: Slot selection + contact (redesigned)
// ============================================================

import { useEffect, useState } from 'preact/hooks';
import { InputField } from './FormField';
import DayPicker from './DayPicker';
import TimeSlotButton from './TimeSlotButton';
import type { TimeSlot, DaySlots } from '../../lib/booking/generateSlots';

export interface TimeData {
  name: string;
  email: string;
  phone: string;
  slotStart: string;
  slotEnd: string;
}

interface Props {
  data: TimeData;
  errors: Partial<Record<'name' | 'email' | 'phone' | 'slot', string>>;
  onChange: (data: TimeData) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting?: boolean;
}

export default function StepTime({ data, errors, onChange, onSubmit, onBack, submitting }: Props) {
  const [daySlots, setDaySlots] = useState<DaySlots[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch(`/api/audit/available-slots?days=14&timezone=${encodeURIComponent(timezone)}`);
        if (!res.ok) throw new Error('Failed');
        const json = await res.json();
        if (!cancelled) {
          setDaySlots(json.slots || []);
          if (json.slots?.length > 0 && !selectedDate) {
            setSelectedDate(json.slots[0].date);
          }
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const days = daySlots.map((d) => ({
    date: d.date,
    dayName: d.dayName,
    hasSlots: d.slots.length > 0,
  }));

  const selectedSlots: TimeSlot[] =
    daySlots.find((d) => d.date === selectedDate)?.slots ?? [];

  const handleSelectSlot = (slot: TimeSlot) => {
    onChange({ ...data, slotStart: slot.start, slotEnd: slot.end });
  };

  const canSubmit =
    data.name.trim().length > 0 &&
    data.email.trim().length > 0 &&
    data.email.includes('@') &&
    data.slotStart.length > 0 &&
    !submitting;

  const handleFormSubmit = (e: Event) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <form onSubmit={handleFormSubmit} class="w-full">
      <div class="flex flex-col gap-[20px]">
        {/* Heading */}
        <div class="flex flex-col gap-[6px]">
          <h2 class="font-medium text-[28px] sm:text-[32px] leading-[1.15] tracking-[-0.5px] text-text-primary">
            Choose your time
          </h2>
          <p class="text-[15px] text-text-secondary leading-[1.5]">
            Pick a slot that works for you. We'll review everything before the call.
          </p>
        </div>

        {/* Slot selection */}
        <div class="flex flex-col gap-[12px]">
          {loading ? (
            <div class="flex flex-col gap-[10px]">
              <div class="flex gap-[8px]">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} class="h-[68px] w-[68px] rounded-2xl bg-bg-muted animate-pulse" />
                ))}
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} class="h-[40px] rounded-2xl bg-bg-muted animate-pulse" />
                ))}
              </div>
            </div>
          ) : loadError ? (
            <p class="text-[14px] text-red-500 py-[12px]">
              Could not load available times. Please refresh the page.
            </p>
          ) : daySlots.length === 0 ? (
            <p class="text-[14px] text-text-muted py-[12px]">
              No available slots in the next 14 days. Please check back soon.
            </p>
          ) : (
            <>
              <DayPicker
                days={days}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
              />

              {selectedSlots.length > 0 && (
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
                  {selectedSlots.map((slot) => {
                    const time = new Date(slot.start).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    });
                    const isSelected = data.slotStart === slot.start;
                    return (
                      <TimeSlotButton
                        key={slot.start}
                        time={time}
                        selected={isSelected}
                        onClick={() => handleSelectSlot(slot)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
          {errors.slot && (
            <p class="text-[13px] text-red-500 leading-snug">{errors.slot}</p>
          )}

          <p class="text-[12px] text-text-muted">
            Times in {timezone.replace(/_/g, ' ')}
          </p>
        </div>

        {/* Divider */}
        <div class="border-t border-border-subtle/60 my-[4px]" />

        {/* Contact fields */}
        <div class="flex flex-col gap-[14px]">
          <p class="text-[13px] font-semibold text-text-primary uppercase tracking-wider">
            Your details
          </p>
          <InputField
            label="Full name"
            required
            name="name"
            value={data.name}
            onChange={(e) => onChange({ ...data, name: (e.target as HTMLInputElement).value })}
            placeholder="John Smith"
            error={errors.name}
            autoComplete="name"
          />
          <InputField
            label="Email"
            required
            type="email"
            name="email"
            value={data.email}
            onChange={(e) => onChange({ ...data, email: (e.target as HTMLInputElement).value })}
            placeholder="john@example.com"
            error={errors.email}
            autoComplete="email"
          />
          <InputField
            label="Phone (optional)"
            type="tel"
            name="phone"
            value={data.phone}
            onChange={(e) => onChange({ ...data, phone: (e.target as HTMLInputElement).value })}
            placeholder="+1 (555) 123-4567"
            autoComplete="tel"
          />
        </div>

        {/* CTAs */}
        <div class="flex flex-col sm:flex-row gap-[10px] mt-[4px]">
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            class="inline-flex items-center justify-center gap-[8px] w-full sm:w-auto px-[24px] py-[14px] rounded-2xl bg-white border border-border-subtle text-text-primary text-[15px] font-medium leading-none transition-all duration-200 hover:bg-bg-muted disabled:opacity-40"
          >
            <svg class="size-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            class="inline-flex items-center justify-center gap-[8px] flex-1 sm:flex-none px-[24px] py-[16px] rounded-2xl bg-bg-dark text-white text-[16px] font-semibold leading-none transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Booking...' : 'Book free audit'}
          </button>
        </div>
      </div>
    </form>
  );
}
