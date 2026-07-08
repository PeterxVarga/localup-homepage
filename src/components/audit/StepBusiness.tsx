// ============================================================
// StepBusiness — Step 1: Business basics (redesigned)
// ============================================================

import { InputField, SelectField } from './FormField';
import { businessTypes } from '../../lib/audit/config';

export interface BusinessData {
  businessName: string;
  websiteUrl: string;
  noWebsite: boolean;
  city: string;
  businessType: string;
}

interface Props {
  data: BusinessData;
  errors: Partial<Record<keyof BusinessData, string>>;
  onChange: (data: BusinessData) => void;
  onContinue: () => void;
  submitting?: boolean;
}

export default function StepBusiness({ data, errors, onChange, onContinue, submitting }: Props) {
  const handleChange = (field: keyof BusinessData, value: string | boolean) => {
    const next = { ...data, [field]: value };
    if (field === 'noWebsite' && value === true) {
      next.websiteUrl = '';
    }
    onChange(next);
  };

  const canContinue =
    data.businessName.trim().length > 0 &&
    data.city.trim().length > 0 &&
    data.businessType.length > 0 &&
    (data.noWebsite || data.websiteUrl.trim().length > 0);

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (canContinue && !submitting) onContinue();
  };

  return (
    <form onSubmit={handleSubmit} class="w-full">
      <div class="flex flex-col gap-[20px]">
        {/* Heading */}
        <div class="flex flex-col gap-[6px]">
          <h2 class="font-medium text-[28px] sm:text-[32px] leading-[1.15] tracking-[-0.5px] text-text-primary">
            Tell us about your business
          </h2>
          <p class="text-[15px] text-text-secondary leading-[1.5]">
            We'll use this to review your local presence before the call.
          </p>
        </div>

        {/* Fields */}
        <div class="flex flex-col gap-[16px]">
          <InputField
            label="Business name"
            required
            name="businessName"
            value={data.businessName}
            onChange={(e) => handleChange('businessName', (e.target as HTMLInputElement).value)}
            placeholder="Your business name"
            error={errors.businessName}
            autoComplete="organization"
          />

          <div class="flex flex-col gap-[6px]">
            <InputField
              label="Website URL"
              name="websiteUrl"
              value={data.websiteUrl}
              onChange={(e) => handleChange('websiteUrl', (e.target as HTMLInputElement).value)}
              placeholder="https://yourbusiness.com"
              error={errors.websiteUrl}
              autoComplete="url"
            />
            <label class="flex items-center gap-[10px] cursor-pointer select-none mt-[2px]">
              <input
                type="checkbox"
                checked={data.noWebsite}
                onChange={(e) => handleChange('noWebsite', (e.target as HTMLInputElement).checked)}
                class="size-[18px] rounded-[6px] border-border-subtle text-bg-dark accent-bg-dark cursor-pointer"
              />
              <span class="text-[14px] text-text-secondary">I don't have a website</span>
            </label>
          </div>

          <InputField
            label="City / service area"
            required
            name="city"
            value={data.city}
            onChange={(e) => handleChange('city', (e.target as HTMLInputElement).value)}
            placeholder="Austin, TX"
            error={errors.city}
            autoComplete="address-level2"
          />

          <SelectField
            label="Business type"
            required
            name="businessType"
            value={data.businessType}
            onChange={(e) => handleChange('businessType', (e.target as HTMLSelectElement).value)}
            options={businessTypes}
            placeholder="Select your business type"
            error={errors.businessType}
          />
        </div>

        {/* CTA */}
        <button
          type="submit"
          disabled={!canContinue || submitting}
          class="inline-flex items-center justify-center gap-[8px] w-full px-[24px] py-[16px] rounded-2xl bg-bg-dark text-white text-[16px] font-semibold leading-none transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed mt-[4px]"
        >
          {submitting ? 'Saving...' : 'Continue'}
          <svg class="size-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>

        <p class="text-[13px] text-text-muted text-center">
          ⏱ Takes about 60–90 seconds
        </p>
      </div>
    </form>
  );
}
