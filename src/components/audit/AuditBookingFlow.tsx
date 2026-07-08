// ============================================================
// AuditBookingFlow — main state machine (redesigned wrapper)
// ============================================================

import { useState, useEffect } from 'preact/hooks';
import ProgressIndicator from './ProgressIndicator';
import StepBusiness, { type BusinessData } from './StepBusiness';
import StepGoals, { type GoalsData } from './StepGoals';
import StepTime, { type TimeData } from './StepTime';
import StepConfirmation from './StepConfirmation';

type Step = 1 | 2 | 3 | 'confirmation';

interface ConfirmationData {
  businessName: string;
  goals: string[];
  slotStart: string;
  slotEnd: string;
  email: string;
  status: string;
}

const steps = [
  { label: 'Business' },
  { label: 'Goals' },
  { label: 'Time' },
];

export default function AuditBookingFlow() {
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const getUrlParams = () => {
    if (typeof window === 'undefined') return {};
    const p = new URLSearchParams(window.location.search);
    return {
      ctaLocation: p.get('cta_location') || undefined,
      utmSource: p.get('utm_source') || undefined,
      utmMedium: p.get('utm_medium') || undefined,
      utmCampaign: p.get('utm_campaign') || undefined,
    };
  };

  const urlParams = getUrlParams();

  const [sessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('audit_session_id');
      if (stored) return stored;
      const id = crypto.randomUUID();
      sessionStorage.setItem('audit_session_id', id);
      return id;
    }
    return '';
  });

  const [businessData, setBusinessData] = useState<BusinessData>({
    businessName: '',
    websiteUrl: '',
    noWebsite: false,
    city: '',
    businessType: '',
  });
  const [businessErrors, setBusinessErrors] = useState<Partial<Record<keyof BusinessData, string>>>({});

  const [goalsData, setGoalsData] = useState<GoalsData>({ goals: [], notes: '' });
  const [goalsErrors, setGoalsErrors] = useState<Partial<Record<'goals' | 'notes', string>>>({});

  const [timeData, setTimeData] = useState<TimeData>({
    name: '',
    email: '',
    phone: '',
    slotStart: '',
    slotEnd: '',
  });
  const [timeErrors, setTimeErrors] = useState<Partial<Record<'name' | 'email' | 'phone' | 'slot', string>>>({});

  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);

  useEffect(() => {
    trackServer('audit_flow_started', {});
  }, []);

  const goToStep1 = () => {
    const errs: typeof businessErrors = {};
    if (!businessData.businessName.trim()) errs.businessName = 'Business name is required';
    if (!businessData.city.trim()) errs.city = 'City or service area is required';
    if (!businessData.businessType) errs.businessType = 'Please select your business type';
    if (!businessData.noWebsite && !businessData.websiteUrl.trim()) {
      errs.websiteUrl = 'Enter your website URL or select "I don\'t have a website"';
    }
    if (businessData.websiteUrl && !businessData.noWebsite) {
      try { new URL(businessData.websiteUrl); } catch { errs.websiteUrl = 'Please enter a valid URL'; }
    }

    setBusinessErrors(errs);
    if (Object.keys(errs).length > 0) return;

    trackServer('audit_step_1_completed', {
      business_name: businessData.businessName,
      city: businessData.city,
      business_type: businessData.businessType,
    });
    setStep(2);
  };

  const goToStep2 = () => {
    const errs: typeof goalsErrors = {};
    if (goalsData.goals.length === 0) errs.goals = 'Select at least one area to improve';
    setGoalsErrors(errs);
    if (Object.keys(errs).length > 0) return;

    trackServer('audit_step_2_completed', { goals: goalsData.goals });
    setStep(3);
  };

  const submitBooking = async () => {
    const errs: typeof timeErrors = {};
    if (!timeData.name.trim()) errs.name = 'Your name is required';
    if (!timeData.email.trim() || !timeData.email.includes('@')) errs.email = 'Please enter a valid email address';
    if (!timeData.slotStart) errs.slot = 'Please select a time slot';
    setTimeErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setServerError(null);

    try {
      const res = await fetch('/api/audit/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: businessData.businessName,
          websiteUrl: businessData.websiteUrl || '',
          noWebsite: businessData.noWebsite,
          city: businessData.city,
          businessType: businessData.businessType,
          goals: goalsData.goals,
          notes: goalsData.notes || '',
          name: timeData.name,
          email: timeData.email,
          phone: timeData.phone || '',
          slotStart: timeData.slotStart,
          slotEnd: timeData.slotEnd,
          ctaLocation: urlParams.ctaLocation,
          sourceUrl: typeof window !== 'undefined' ? window.location.href : '',
          sessionId,
        }),
      });

      const result = await res.json();

      if (result.success) {
        setConfirmation({
          businessName: businessData.businessName,
          goals: goalsData.goals,
          slotStart: timeData.slotStart,
          slotEnd: timeData.slotEnd,
          email: timeData.email,
          status: result.status || 'booked',
        });
        setStep('confirmation');
      } else {
        if (result.error === 'slot_taken') {
          setTimeErrors({ slot: result.message });
          setTimeData({ ...timeData, slotStart: '', slotEnd: '' });
        } else {
          setServerError(result.message || 'Something went wrong. Please try again.');
        }
      }
    } catch {
      setServerError('Connection lost. Please check your internet and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const trackServer = async (eventName: string, metadata: Record<string, unknown>) => {
    try {
      await fetch('/api/audit/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _trackOnly: true,
          eventName,
          sessionId,
          metadata: { ...metadata, cta_location: urlParams.ctaLocation },
          sourceUrl: typeof window !== 'undefined' ? window.location.href : '',
        }),
      });
    } catch { /* silent */ }
  };

  if (step === 'confirmation' && confirmation) {
    return <StepConfirmation data={confirmation} />;
  }

  return (
    <div class="w-full">
      <ProgressIndicator
        currentStep={step as number}
        steps={steps}
        onStepClick={(s) => { if (s < (step as number)) setStep(s as Step); }}
      />

      {serverError && (
        <div class="mb-[20px] p-[14px] bg-red-50 border border-red-200 rounded-2xl text-[14px] text-red-700 leading-snug">
          {serverError}
        </div>
      )}

      {step === 1 && (
        <StepBusiness
          data={businessData}
          errors={businessErrors}
          onChange={setBusinessData}
          onContinue={goToStep1}
          submitting={submitting}
        />
      )}

      {step === 2 && (
        <StepGoals
          data={goalsData}
          errors={goalsErrors}
          onChange={setGoalsData}
          onContinue={goToStep2}
          onBack={() => setStep(1)}
          submitting={submitting}
        />
      )}

      {step === 3 && (
        <StepTime
          data={timeData}
          errors={timeErrors}
          onChange={setTimeData}
          onSubmit={submitBooking}
          onBack={() => setStep(2)}
          submitting={submitting}
        />
      )}
    </div>
  );
}
