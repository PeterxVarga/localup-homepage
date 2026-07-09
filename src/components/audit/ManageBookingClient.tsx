// ============================================================
// ManageBookingClient — interactive manage page UI
// Supports: view details, join Meet, reschedule, cancel
// ============================================================

import { useState, useRef, useEffect } from 'preact/hooks';
import DayPicker from './DayPicker';
import TimeSlotButton from './TimeSlotButton';
import type { DaySlots, TimeSlot } from '../../lib/booking/generateSlots';

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
    rescheduleCutoffPassed: boolean;
    rescheduleCount: number;
    maxReschedules: number;
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
  const [slotStart, setSlotStart] = useState(details.slotStart);
  const [slotEnd, setSlotEnd] = useState(details.slotEnd);
  const [rescheduleCount, setRescheduleCount] = useState(details.rescheduleCount);

  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [daySlots, setDaySlots] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedNewSlot, setSelectedNewSlot] = useState<TimeSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cancelRef = useRef(false);
  const rescheduleRef = useRef(false);

  const slotText = formatSlot(slotStart, slotEnd);
  const maxReschedulesReached = rescheduleCount >= details.maxReschedules;

  useEffect(() => {
    if (mode !== 'reschedule') return;

    let cancelled = false;
    async function load() {
      setLoadingSlots(true);
      setError(null);
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch(
          `/api/audit/available-slots?days=14&timezone=${encodeURIComponent(timezone)}`,
        );
        if (!res.ok) throw new Error('Failed');
        const json = await res.json();
        if (!cancelled) {
          setDaySlots(json.slots || []);
          if (json.slots?.length > 0 && !selectedDate) {
            setSelectedDate(json.slots[0].date);
          }
        }
      } catch {
        if (!cancelled) setError('Nem sikerült betölteni az időpontokat.');
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const days = daySlots.map((d) => ({
    date: d.date,
    dayName: d.dayName,
    hasSlots: d.slots.length > 0,
  }));

  const selectedSlots: TimeSlot[] =
    daySlots.find((d) => d.date === selectedDate)?.slots ?? [];

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

  const handleReschedule = async () => {
    if (rescheduleRef.current || rescheduling) return;
    if (!selectedNewSlot) {
      setError('Kérlek válassz egy új időpontot.');
      return;
    }

    rescheduleRef.current = true;
    setRescheduling(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/audit/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          expectedOldSlotStart: slotStart,
          newSlotStart: selectedNewSlot.start,
        }),
      });

      const result = await res.json();

      if (result.success) {
        setSlotStart(result.newSlotStart);
        setSlotEnd(result.newSlotEnd);
        setRescheduleCount(result.rescheduleCount);
        setMode('view');
        setSelectedNewSlot(null);
        setSuccess(
          result.idempotent
            ? 'A foglalás már erre az időpontra van.'
            : 'Az időpontot sikeresen módosítottuk.',
        );
      } else {
        setError(result.message || 'Hiba történt. Kérlek próbáld újra.');
      }
    } catch {
      setError('Kapcsolódási hiba. Kérlek ellenőrizd az internetet.');
    } finally {
      rescheduleRef.current = false;
      setRescheduling(false);
    }
  };

  if (isCancelled) {
    return (
      <div class="bg-white border border-border-subtle rounded-[24px] p-[32px] md:p-[48px] shadow-card">
        <h1 class="font-medium text-[28px] md:text-[36px] leading-[1.1] tracking-[-0.5px] text-text-primary mb-[16px]">
          Foglalás lemondva
        </h1>
        <p class="text-[16px] text-text-secondary leading-relaxed mb-[24px]">
          Ez a LocalUp audit foglalás a(z) <strong>{details.businessName}</strong> számára le lett mondva.
        </p>
        <p class="text-[15px] text-text-muted">Lemondott időpont: {slotText}</p>
      </div>
    );
  }

  return (
    <div class="bg-white border border-border-subtle rounded-[24px] p-[32px] md:p-[48px] shadow-card">
      <h1 class="font-medium text-[28px] md:text-[36px] leading-[1.1] tracking-[-0.5px] text-text-primary mb-[16px]">
        Foglalás kezelése
      </h1>

      <p class="text-[16px] text-text-secondary leading-relaxed mb-[24px]">
        LocalUp audit: <strong>{details.businessName}</strong>
      </p>

      <div class="space-y-[16px] text-[15px] text-text-primary mb-[32px]">
        <p>
          <span class="text-text-muted">Aktuális időpont:</span>
          <br />
          {slotText}
        </p>
        <p>
          <span class="text-text-muted">Név:</span> {details.name}
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

      {mode === 'reschedule' && (
        <div class="mb-[32px] flex flex-col gap-[16px]">
          <p class="text-[13px] font-semibold text-text-primary uppercase tracking-wider">
            Válassz új időpontot
          </p>

          {loadingSlots ? (
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
          ) : daySlots.length === 0 ? (
            <p class="text-[14px] text-text-muted">Nincs elérhető időpont.</p>
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
                    const time = new Date(slot.start).toLocaleTimeString('hu-HU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const isSelected = selectedNewSlot?.start === slot.start;
                    return (
                      <TimeSlotButton
                        key={slot.start}
                        time={time}
                        selected={isSelected}
                        onClick={() => setSelectedNewSlot(slot)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div class="flex flex-col sm:flex-row gap-[10px] mt-[8px]">
            <button
              type="button"
              onClick={() => {
                setMode('view');
                setSelectedNewSlot(null);
                setError(null);
              }}
              disabled={rescheduling}
              class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[14px] rounded-2xl bg-white border border-border-subtle text-text-primary text-[15px] font-medium leading-none hover:bg-bg-muted transition-colors disabled:opacity-40"
            >
              Mégse
            </button>
            <button
              type="button"
              onClick={handleReschedule}
              disabled={!selectedNewSlot || rescheduling}
              class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[16px] rounded-2xl bg-bg-dark text-white text-[16px] font-semibold leading-none hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {rescheduling ? 'Módosítás...' : 'Új időpont megerősítése'}
            </button>
          </div>
        </div>
      )}

      {mode === 'view' && (
        <div class="flex flex-col sm:flex-row gap-[12px]">
          {details.meetLink && (
            <a
              href={details.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[16px] rounded-2xl bg-bg-dark text-white text-[16px] font-semibold leading-none hover:opacity-90 transition-opacity"
            >
              Csatlakozás Google Meethez
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              if (maxReschedulesReached || details.rescheduleCutoffPassed) return;
              setMode('reschedule');
              setError(null);
              setSuccess(null);
            }}
            disabled={maxReschedulesReached || details.rescheduleCutoffPassed}
            class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[16px] rounded-2xl bg-white border border-border-subtle text-text-primary text-[16px] font-medium leading-none hover:bg-bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Időpont módosítása
          </button>

          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling || details.cancelCutoffPassed}
            class="inline-flex items-center justify-center gap-[8px] px-[24px] py-[16px] rounded-2xl bg-white border border-border-subtle text-text-primary text-[16px] font-medium leading-none hover:bg-bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cancelling ? 'Lemondás...' : 'Foglalás lemondása'}
          </button>
        </div>
      )}

      {details.rescheduleCutoffPassed && mode === 'view' && (
        <p class="mt-[16px] text-[13px] text-text-muted">
          Az önkiszolgáló módosítási ablak lezárult. Kérlek válaszolj a visszaigazoló emailre.
        </p>
      )}

      {maxReschedulesReached && mode === 'view' && (
        <p class="mt-[16px] text-[13px] text-text-muted">
          További módosításhoz válaszolj a visszaigazoló emailre.
        </p>
      )}
    </div>
  );
}
