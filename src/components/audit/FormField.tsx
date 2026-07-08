// ============================================================
// FormField — refined inputs for LocalUp design system
// ============================================================

import type { JSX } from 'preact';

interface BaseProps {
  label: string;
  error?: string;
  required?: boolean;
  class?: string;
}

interface InputProps extends BaseProps {
  type?: 'text' | 'email' | 'tel' | 'url';
  name: string;
  value: string;
  onChange: (e: JSX.TargetedEvent<HTMLInputElement, Event>) => void;
  placeholder?: string;
  autoComplete?: string;
}

interface SelectProps extends BaseProps {
  name: string;
  value: string;
  onChange: (e: JSX.TargetedEvent<HTMLSelectElement, Event>) => void;
  options: readonly string[];
  placeholder?: string;
}

interface TextareaProps extends BaseProps {
  name: string;
  value: string;
  onChange: (e: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => void;
  placeholder?: string;
  rows?: number;
}

const baseInputClass =
  'w-full px-[16px] py-[14px] rounded-2xl border bg-white text-[15px] text-text-primary placeholder:text-text-muted/70 outline-none transition-all duration-200';

const inputDefaultClass = `${baseInputClass} border-border-subtle focus:border-bg-dark/60 focus:ring-2 focus:ring-bg-dark/5`;

const inputErrorClass = `${baseInputClass} border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100`;

export function InputField({
  label,
  error,
  required,
  type = 'text',
  name,
  value,
  onChange,
  placeholder,
  autoComplete,
  class: className = '',
}: InputProps) {
  return (
    <div class={`flex flex-col gap-[6px] ${className}`}>
      <label
        for={name}
        class="text-[14px] font-medium text-text-primary"
      >
        {label}
        {required && <span class="text-accent-strong ml-[2px]">*</span>}
      </label>
      <input
        id={name}
        type={type}
        name={name}
        value={value}
        onInput={onChange}
        placeholder={placeholder}
        autocomplete={autoComplete}
        class={error ? inputErrorClass : inputDefaultClass}
      />
      {error && (
        <p class="text-[13px] text-red-500 leading-snug">{error}</p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  required,
  name,
  value,
  onChange,
  options,
  placeholder,
  class: className = '',
}: SelectProps) {
  return (
    <div class={`flex flex-col gap-[6px] ${className}`}>
      <label for={name} class="text-[14px] font-medium text-text-primary">
        {label}
        {required && <span class="text-accent-strong ml-[2px]">*</span>}
      </label>
      <div class="relative">
        <select
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          class={error ? inputErrorClass : `${inputDefaultClass} appearance-none pr-[40px]`}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <div class="absolute right-[16px] top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
          <svg class="size-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>
      {error && (
        <p class="text-[13px] text-red-500 leading-snug">{error}</p>
      )}
    </div>
  );
}

export function TextareaField({
  label,
  error,
  required,
  name,
  value,
  onChange,
  placeholder,
  rows = 3,
  class: className = '',
}: TextareaProps) {
  return (
    <div class={`flex flex-col gap-[6px] ${className}`}>
      <label for={name} class="text-[14px] font-medium text-text-primary">
        {label}
        {required && <span class="text-accent-strong ml-[2px]">*</span>}
      </label>
      <textarea
        id={name}
        name={name}
        value={value}
        onInput={onChange}
        placeholder={placeholder}
        rows={rows}
        class={`${error ? inputErrorClass : inputDefaultClass} resize-none`}
      />
      {error && (
        <p class="text-[13px] text-red-500 leading-snug">{error}</p>
      )}
    </div>
  );
}
