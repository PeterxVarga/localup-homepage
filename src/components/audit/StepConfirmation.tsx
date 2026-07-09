// ============================================================
// StepConfirmation — booking confirmation (redesigned)
// ============================================================

interface ConfirmationData {
  businessName: string;
  goals: string[];
  slotStart: string;
  slotEnd: string;
  email: string;
  bookingStatus: 'pending' | 'booked' | 'cancelled';
  calendarSyncStatus: 'pending' | 'synced' | 'failed';
}

interface Props {
  data: ConfirmationData;
}

const goalLabels: Record<string, string> = {
  more_visibility: 'More local visibility',
  more_calls: 'More calls / bookings',
  better_website: 'Better website',
  more_reviews: 'More reviews',
  not_sure: 'Not sure yet',
};

const DISPLAY_TIMEZONE = 'Europe/Budapest';

export default function StepConfirmation({ data }: Props) {
  const slotDate = new Date(data.slotStart);
  const dateStr = slotDate.toLocaleDateString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = slotDate.toLocaleTimeString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  const endDate = new Date(data.slotEnd);
  const endTimeStr = endDate.toLocaleTimeString('hu-HU', {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });

  const goalList = data.goals.map((g) => goalLabels[g] || g);

  return (
    <div class="flex flex-col items-center gap-[28px] text-center w-full">
      {/* Success icon */}
      <div class="bg-bg-card-warm flex items-center justify-center rounded-full size-[72px]">
        <svg class="size-[28px] text-bg-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>

      {/* Heading */}
      <div class="flex flex-col gap-[8px]">
        <h2 class="font-medium text-[28px] sm:text-[32px] leading-[1.15] tracking-[-0.5px] text-text-primary">
          Your audit is booked
        </h2>
        <p class="text-[15px] text-text-secondary leading-[1.5] max-w-[400px]">
          We'll review your website, local visibility, and trust signals before the call.
        </p>
      </div>

      {/* Booking details card */}
      <div class="bg-white border border-border-subtle rounded-2xl p-[24px] sm:p-[28px] w-full max-w-[400px] text-left shadow-sm">
        <div class="flex flex-col gap-[14px]">
          <p class="text-[12px] font-semibold text-text-muted uppercase tracking-wider leading-none">
            Booking details
          </p>

          <div class="flex flex-col gap-[10px]">
            {data.businessName && (
              <DetailRow label="Business" value={data.businessName} />
            )}
            <DetailRow label="Date" value={dateStr} />
            <DetailRow label="Time" value={`${timeStr} – ${endTimeStr}`} />
            {goalList.length > 0 && (
              <DetailRow label="Goals" value={goalList.join(', ')} />
            )}
            <DetailRow label="Email" value={data.email} />
          </div>

          {data.calendarSyncStatus === 'failed' && (
            <p class="text-[13px] text-amber-600 leading-snug mt-[2px]">
              Booking confirmed — calendar sync pending. We'll reach out to confirm.
            </p>
          )}
        </div>
      </div>

      {/* CTA */}
      <a
        href="/"
        class="inline-flex items-center justify-center gap-[8px] px-[28px] py-[14px] rounded-2xl bg-bg-dark text-white text-[15px] font-semibold leading-none transition-all duration-200 hover:opacity-90"
      >
        <svg class="size-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to homepage
      </a>

      {/* Email note */}
      <p class="text-[13px] text-text-muted">
        Confirmation email sent to {data.email}
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex flex-col sm:flex-row sm:justify-between sm:gap-[12px]">
      <span class="text-[12px] font-semibold text-text-muted uppercase tracking-wider leading-snug shrink-0">
        {label}
      </span>
      <span class="text-[14px] font-medium text-text-primary leading-snug sm:text-right">
        {value}
      </span>
    </div>
  );
}
