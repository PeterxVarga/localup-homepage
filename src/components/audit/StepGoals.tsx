// ============================================================
// StepGoals — Step 2: Goals selection (redesigned)
// ============================================================

import { TextareaField } from './FormField';
import GoalPill from './GoalPill';
import { goalOptions } from '../../lib/audit/config';

export interface GoalsData {
  goals: string[];
  notes: string;
}

interface Props {
  data: GoalsData;
  errors: Partial<Record<'goals' | 'notes', string>>;
  onChange: (data: GoalsData) => void;
  onContinue: () => void;
  onBack: () => void;
  submitting?: boolean;
}

export default function StepGoals({ data, errors, onChange, onContinue, onBack, submitting }: Props) {
  const toggleGoal = (goalId: string) => {
    const next = data.goals.includes(goalId)
      ? data.goals.filter((g) => g !== goalId)
      : [...data.goals, goalId];
    onChange({ ...data, goals: next });
  };

  const canContinue = data.goals.length > 0;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (canContinue && !submitting) onContinue();
  };

  const goalLabels: Record<string, string> = {
    more_visibility: 'More local visibility',
    more_calls: 'More calls / bookings',
    better_website: 'Better website',
    more_reviews: 'More reviews',
    not_sure: 'Not sure yet',
  };

  return (
    <form onSubmit={handleSubmit} class="w-full">
      <div class="flex flex-col gap-[20px]">
        {/* Heading */}
        <div class="flex flex-col gap-[6px]">
          <h2 class="font-medium text-[28px] sm:text-[32px] leading-[1.15] tracking-[-0.5px] text-text-primary">
            What should we look at first?
          </h2>
          <p class="text-[15px] text-text-secondary leading-[1.5]">
            Choose the areas you want to improve. You can select more than one.
          </p>
        </div>

        {/* Goal pills */}
        <div class="flex flex-col gap-[10px]">
          {goalOptions.map((goal) => (
            <GoalPill
              key={goal.id}
              label={goalLabels[goal.id] || goal.id}
              selected={data.goals.includes(goal.id)}
              onClick={() => toggleGoal(goal.id)}
            />
          ))}
        </div>
        {errors.goals && (
          <p class="text-[13px] text-red-500 leading-snug">{errors.goals}</p>
        )}

        {/* Notes */}
        <TextareaField
          label="Anything we should know?"
          name="notes"
          value={data.notes}
          onChange={(e) => onChange({ ...data, notes: (e.target as HTMLTextAreaElement).value })}
          placeholder="Optional — share any specific concerns or goals..."
          rows={3}
        />

        {/* CTAs */}
        <div class="flex flex-col sm:flex-row gap-[10px] mt-[4px]">
          <button
            type="button"
            onClick={onBack}
            class="inline-flex items-center justify-center gap-[8px] w-full sm:w-auto px-[24px] py-[14px] rounded-2xl bg-white border border-border-subtle text-text-primary text-[15px] font-medium leading-none transition-all duration-200 hover:bg-bg-muted"
          >
            <svg class="size-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back
          </button>
          <button
            type="submit"
            disabled={!canContinue || submitting}
            class="inline-flex items-center justify-center gap-[8px] flex-1 sm:flex-none px-[24px] py-[16px] rounded-2xl bg-bg-dark text-white text-[16px] font-semibold leading-none transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Choose a time'}
            <svg class="size-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
