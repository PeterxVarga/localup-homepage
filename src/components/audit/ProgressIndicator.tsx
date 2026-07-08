// ============================================================
// ProgressIndicator — clean step progress
// ============================================================

interface Props {
  currentStep: number;
  onStepClick?: (step: number) => void;
  steps: { label: string }[];
}

export default function ProgressIndicator({ currentStep, onStepClick, steps }: Props) {
  return (
    <div class="flex items-center justify-center gap-0 w-full max-w-[400px] mx-auto mb-[40px] md:mb-[48px]">
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const isClickable = isDone && onStepClick;

        return (
          <div key={stepNum} class="flex items-center flex-1 last:flex-none">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick?.(stepNum)}
              class={`flex flex-col items-center gap-[8px] shrink-0 ${
                isClickable ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              {/* Circle */}
              <div
                class={`flex items-center justify-center rounded-full shrink-0 size-[32px] text-[13px] font-semibold transition-all duration-200 ${
                  isActive
                    ? 'bg-bg-dark text-white'
                    : isDone
                      ? 'bg-bg-dark text-white'
                      : 'bg-white border border-border-subtle text-text-muted'
                }`}
              >
                {isDone ? (
                  <svg class="size-[14px]" fill="none" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M1 5l3 3 5-6" />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              {/* Label */}
              <span
                class={`text-[11px] font-semibold uppercase tracking-wider leading-none whitespace-nowrap ${
                  isActive ? 'text-text-primary' : isDone ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                class={`flex-1 h-[2px] mx-[6px] rounded-full ${
                  stepNum < currentStep ? 'bg-bg-dark' : 'bg-border-subtle'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
