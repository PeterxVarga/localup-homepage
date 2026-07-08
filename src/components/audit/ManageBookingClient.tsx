// ============================================================
// ManageBookingClient — interactive manage page UI
// ============================================================

import { useState, useRef } from 'preact/hooks';

export interface ManageBookingClientProps {
  details: {
    bookingId: string;
    businessName: string;
    name: string;
    email: string;
    slotStart: string;
    slotEnd: string;
    meetLink?: string;
    isCancelled: boolean;
    cancelCutoffPassed: boolean;
  };
  token: string;
}

function formatSlot(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateStr = startDate.toLocaleDateString('hu-HU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const startTime = startDate.toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = endDate.toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr}, ${startTime}–${endTime}`;
}

export default function ManageBookingClient({
  details,
  token,
}: ManageBookingClientProps) {
  const [isCancelled, setIsCancelled] = useState(details.isCancelled);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const slotText = formatSlot(details.slotStart, details.slotEnd);

  const handleCancel = async () => {
    if (cancelRef.current || cancelling) return;
    if (!window.confirm('Biztosan lemondod ezt az időpontot?')) return;

    cancelRef.current = true;
    setCancelling(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/audit/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const result = await res.json();

      if (result.success) {
        setIsCancelled(true);
        setSuccess(
          result.alreadyCancelled
            ? 'Ez a foglalás már le lett mondva.'
            : 'A foglalást sikeresen lemondtuk.',
        );
      } else {
        setError(result.message || 'Hiba történt. Kérlek próbáld újra.');
      }
    } catch {
      setError('Kapcsolódási hiba. Kérlek ellenőrizd az internetet.');
    } finally {
      cancelRef.current = false;
      setCancelling(false);
    }
  };

  if (isCancelled) {
    return (
      <div class="bg-white border border-border-subtle rounded-[24px] p-[32px] md:p-[48px] shadow-card">
        <h1 class="font-medium text-[28px] md:text-[36px] leading-[1.1] tracking-[-0.5px] text-text-primary mb-[16px]">
          Booking cancelled
        </h1>
        <p class="text-[16px] text-text-secondary leading-relaxed mb-[24px]">
          This LocalUp audit call for <strong>{details.businessName}</strong> has been cancelled.
        </p>
        <p class="text-[15px] text-text-muted">Cancelled slot: {slotText}</p>
      </div>
    );
  }

  return (
    <div class="bg-white border border-border-subtle rounded-[24px] p-[32px] md:p-[48px] shadow-card">
      <h1 class="font-medium text-[28px] md:text-[36px] leading-[1.1] tracking-[-0.5px] text-text-primary mb-[16px]">
        Manage your booking
      </h1>

      <p class="text-[16px] text-text-secondary leading-relaxed mb-[24px]">
        LocalUp audit call for <strong>{details.businessName}</strong>
      </p>

      <div class="space-y-[16px] text-[15px] text-text-primary mb-[32px]">
        <p>
          <span class="text-text-muted">Date & time:</span>
          <br />
          {slotText}
        </p>
        <p>
          <span class="text-text-muted">Name:</span> {details.name}
          <br />
          <span class="text-text-muted">Email:</span> {details.email}
        </p>

        {details.meetLink && (
          <p>
            <span class="text-text-muted">Google Meet:</span>
            <br />
            <a
              href={details.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent-strong hover:underline break-all"
            >
              {details.meetLink}
            </a>
          </p>
        )}
      </div>

      {error && (
        <div class="mb-[20px] p-[14px] bg-red-50 border border-red-200 rounded-2xl text-[14px] text-red-700 leading-snug">
          {error}
        </div>
      )}

      {success && (
        <div class="mb-[20px] p-[14px] bg-green-50 border border-green-200 rounded-2xl text-[14px] text-green-700 leading-snug">
          {success}
        </div>
      )}

      <div class="flex flex-col sm:flex-row gap-[12px]">
        {details.meetLink && (
          <a
            href={details.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[16px] rounded-2xl bg-bg-dark text-white text-[16px] font-semibold leading-none hover:opacity-90 transition-opacity"
          >
            Join Google Meet
          </a>
        )}

        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling || details.cancelCutoffPassed}
          class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[16px] rounded-2xl bg-white border border-border-subtle text-text-primary text-[16px] font-medium leading-none hover:bg-bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {cancelling ? 'Cancelling...' : 'Cancel booking'}
        </button>
      </div>

      {details.cancelCutoffPassed && (
        <p class="mt-[16px] text-[13px] text-text-muted">
          The self-service cancellation window has closed. Please reply to your confirmation email to make changes.
        </p>
      )}
    </div>
  );
}
