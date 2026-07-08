// ============================================================
// DayPicker — horizontal day selector (redesigned)
// ============================================================

interface Props {
  days: { date: string; dayName: string; hasSlots: boolean }[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}

export default function DayPicker({ days, selectedDate, onSelect }: Props) {
  if (days.length === 0) {
    return (
      <p class="text-[14px] text-text-muted py-[12px]">
        No available days in the next two weeks.
      </p>
    );
  }

  return (
    <div class="flex gap-[8px] overflow-x-auto pb-[4px] -mx-[4px] px-[4px]">
      {days.map((day) => {
        const isSelected = day.date === selectedDate;
        const dateObj = new Date(day.date + 'T00:00:00');
        const dayNum = dateObj.getDate();
        const dayShort = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        const monthShort = dateObj.toLocaleDateString('en-US', { month: 'short' });

        return (
          <button
            key={day.date}
            type="button"
            disabled={!day.hasSlots}
            onClick={() => day.hasSlots && onSelect(day.date)}
            class={`flex flex-col items-center gap-[2px] shrink-0 px-[12px] py-[10px] rounded-2xl border text-center transition-all duration-200 min-w-[68px] ${
              isSelected
                ? 'bg-bg-dark border-bg-dark text-white shadow-sm'
                : day.hasSlots
                  ? 'bg-white border-border-subtle text-text-primary hover:border-bg-dark/30'
                  : 'bg-bg-muted/30 border-border-subtle text-text-muted opacity-50 cursor-not-allowed'
            }`}
          >
            <span class="text-[10px] font-semibold uppercase tracking-wider leading-none opacity-70">
              {dayShort}
            </span>
            <span class="text-[18px] font-semibold leading-none">{dayNum}</span>
            <span class="text-[10px] font-medium leading-none opacity-60">
              {monthShort}
            </span>
          </button>
        );
      })}
    </div>
  );
}
