// ============================================================
// GoalPill — selectable goal card (redesigned)
// ============================================================

interface Props {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export default function GoalPill({ label, selected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`w-full flex items-center justify-between gap-[12px] px-[20px] py-[16px] rounded-2xl border text-left transition-all duration-200 ${
        selected
          ? 'bg-bg-dark border-bg-dark text-white shadow-sm'
          : 'bg-white border-border-subtle text-text-primary hover:border-bg-dark/40 hover:bg-bg-muted/30'
      }`}
    >
      <span class={`text-[15px] leading-snug ${selected ? 'font-medium' : 'font-normal'}`}>
        {label}
      </span>
      {selected && (
        <div class="bg-accent-strong/20 flex items-center justify-center rounded-full shrink-0 size-[22px]">
          <svg class="size-[12px] text-accent-strong" fill="none" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M1 5l3 3 5-6" />
          </svg>
        </div>
      )}
    </button>
  );
}
