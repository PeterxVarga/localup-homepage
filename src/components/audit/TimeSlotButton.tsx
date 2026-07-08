// ============================================================
// TimeSlotButton — individual time slot (redesigned)
// ============================================================

interface Props {
  time: string;
  selected: boolean;
  onClick: () => void;
}

export default function TimeSlotButton({ time, selected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`px-[16px] py-[12px] rounded-2xl border text-[14px] font-medium leading-none transition-all duration-200 text-center ${
        selected
          ? 'bg-bg-dark border-bg-dark text-white shadow-sm'
          : 'bg-white border-border-subtle text-text-primary hover:border-bg-dark/30 hover:bg-bg-muted/20'
      }`}
    >
      {time}
    </button>
  );
}
