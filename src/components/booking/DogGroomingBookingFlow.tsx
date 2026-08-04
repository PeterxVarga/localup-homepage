import { useEffect, useMemo, useState } from 'preact/hooks';
import type { BookingIntakeData } from '../../lib/booking-intake/types';
import type {
  PublicPricingConfig,
  PublicQuoteResponse,
} from '../../lib/booking-pricing/types';
import {
  calculateMockQuote,
  createMockPricingConfig,
  createMockSlots,
  DOG_SERVICES,
  formatHuf,
  formatQuoteDuration,
  formatQuotePrice,
  type BookingDay,
  type BookingSlot,
  type DogServiceSlug,
} from '../../lib/booking-ui/dogGrooming';
import './dogGroomingBooking.css';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type Mode = 'mock' | 'live';

interface Props {
  mode?: Mode;
  siteSlug?: string;
}

interface OwnerData {
  name: string;
  email: string;
  phone: string;
  notes: string;
  privacy: boolean;
}

interface BookingSuccess {
  bookingId: string;
  slotStart: string;
  slotEnd: string;
}

interface DogPhoto {
  previewUrl: string;
  fileName: string;
}

const STEP_LABELS = ['Szolgáltatás', 'Kutyusod', 'Részletek', 'Időpont', 'Adatok'];
const INITIAL_INTAKE: BookingIntakeData = {
  'dog-name': '',
  'dog-breed': '',
  'dog-age-group': 'adult',
  'care-considerations': [],
  'temperament-notes': '',
};

function dateLabel(iso: string, long = true) {
  return new Intl.DateTimeFormat('hu-HU', {
    month: long ? 'long' : 'short',
    day: 'numeric',
    weekday: long ? 'long' : undefined,
  }).format(new Date(iso));
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function googleCalendarUrl(
  success: BookingSuccess,
  serviceName: string,
  dogName: unknown,
) {
  const compact = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${serviceName} – ${String(dogName || 'kutyakozmetika')}`,
    dates: `${compact(success.slotStart)}/${compact(success.slotEnd)}`,
    details: 'Bundás kutyakozmetika időpont',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function dogSizeLabel(weight: unknown) {
  if (typeof weight !== 'number') return 'Méret nélkül';
  if (weight <= 10) return 'S · Kistestű';
  if (weight <= 25) return 'M · Közepes';
  if (weight <= 40) return 'L · Nagytestű';
  return 'XL · Óriástestű';
}

function isDogStepValid(intake: BookingIntakeData) {
  return (
    typeof intake['dog-name'] === 'string' &&
    intake['dog-name'].trim().length > 0 &&
    typeof intake['dog-breed'] === 'string' &&
    intake['dog-breed'].trim().length >= 2 &&
    typeof intake['dog-weight-kg'] === 'number' &&
    intake['dog-weight-kg'] >= 1 &&
    intake['dog-weight-kg'] <= 100 &&
    typeof intake['dog-age-group'] === 'string'
  );
}

function DogFaceIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      class={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m15.4 16.8-4.5-5.9c-.7-.9.2-2.2 1.3-1.8l7 2.2c1.4-.5 3-.8 4.8-.8s3.4.3 4.8.8l7-2.2c1.1-.4 2 .9 1.3 1.8l-4.5 5.9c1.4 1.8 2.2 4 2.2 6.5 0 6.1-4.8 10.9-10.8 10.9S13.2 29.4 13.2 23.3c0-2.5.8-4.7 2.2-6.5Z"
        fill="currentColor"
        fill-opacity=".12"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
      <path
        d="M18.4 23.4h.01M29.6 23.4h.01"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="2.6"
      />
      <path
        d="M24 24.8v2.2m-3.3 1.4c.9.9 2 1.3 3.3 1.3s2.4-.4 3.3-1.3"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
    </svg>
  );
}

function ImagePlusIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M5.3 7.7c0-1.3 1.1-2.4 2.4-2.4h9.7c1.3 0 2.4 1.1 2.4 2.4v2.1"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
      <path
        d="M5.3 20.1V22c0 1.3 1.1 2.4 2.4 2.4h9.7c1.3 0 2.4-1.1 2.4-2.4v-4.1"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
      <path
        d="m5.7 19.2 4.2-4.4a1.4 1.4 0 0 1 2 0l2.1 2.2 1.4-1.5a1.4 1.4 0 0 1 2 0l2.1 2.2"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
      <circle cx="15.4" cy="9.5" r="1.1" fill="currentColor" />
      <path
        d="M24.2 16.2v8.1m-4-4h8"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.8"
      />
    </svg>
  );
}

function DogAgeIcon({ age }: { age: 'puppy' | 'adult' | 'senior' }) {
  return (
    <span class="bundas-age-icon" data-age={age}>
      <DogFaceIcon />
    </span>
  );
}

function SummaryBar({
  config,
  quote,
  intake,
}: {
  config: PublicPricingConfig | null;
  quote: PublicQuoteResponse | null;
  intake: BookingIntakeData;
}) {
  if (!config) return null;
  return (
    <div class="bundas-summary-bar" aria-live="polite">
      <div>
        <span class="bundas-summary-kicker">Kiválasztott szolgáltatás</span>
        <strong>{config.service.name}</strong>
      </div>
      <div>
        <span class="bundas-summary-kicker">Méret</span>
        <strong class="mint-text">{dogSizeLabel(intake['dog-weight-kg'])}</strong>
      </div>
      <div>
        <span class="bundas-summary-kicker">Becsült idő</span>
        <strong>{formatQuoteDuration(quote)}</strong>
      </div>
      <div>
        <span class="bundas-summary-kicker">Jelenlegi becslés</span>
        <strong>{formatQuotePrice(quote)}</strong>
      </div>
    </div>
  );
}

function DogPortrait({
  intake,
  small = false,
  photoUrl,
  photoName,
  onPhotoChange,
}: {
  intake: BookingIntakeData;
  small?: boolean;
  photoUrl?: string;
  photoName?: string;
  onPhotoChange?: (event: Event) => void;
}) {
  const dogName = String(intake['dog-name'] || 'Kutyusod');
  const photoTile = (
    <div class={`bundas-photo-tile ${photoUrl ? 'has-photo' : ''}`}>
      {photoUrl ? (
        <img class="bundas-dog-photo" src={photoUrl} alt={`${dogName} fotója`} />
      ) : (
        <span class="bundas-photo-empty" aria-hidden="true">
          <ImagePlusIcon />
        </span>
      )}
      {!small && photoUrl && <span class="bundas-photo-overlay">Kép cseréje</span>}
    </div>
  );

  return (
    <div class={`bundas-dog-portrait ${small ? 'is-small' : ''}`}>
      {onPhotoChange ? (
        <label class="bundas-photo-dropzone">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPhotoChange}
            aria-label="Kutyus fotójának feltöltése"
          />
          {photoTile}
          {!small && (
            <strong class="bundas-photo-label">
              {photoUrl ? 'Kép cseréje' : 'Fotó hozzáadása · opcionális'}
            </strong>
          )}
        </label>
      ) : (
        <div class="bundas-photo-dropzone is-static">{photoTile}</div>
      )}
      {!small && <small class="bundas-photo-meta" title={photoName}>
        {photoName ? photoName : 'Opcionális · JPG, PNG vagy WEBP'}
      </small>}
    </div>
  );
}

function BookingAside({
  config,
  quote,
  intake,
  photoUrl,
  slot,
  onEdit,
}: {
  config: PublicPricingConfig;
  quote: PublicQuoteResponse;
  intake: BookingIntakeData;
  photoUrl?: string;
  slot?: BookingSlot | null;
  onEdit: () => void;
}) {
  return (
    <aside class="bundas-booking-aside">
      {slot && (
        <div class="bundas-aside-date">
          <span>▣ Kiválasztott időpont</span>
          <strong>{dateLabel(slot.start)}</strong>
          <b>{timeLabel(slot.start)}</b>
        </div>
      )}
      <DogPortrait intake={intake} small photoUrl={photoUrl} />
      <p class="bundas-dog-line">
        {String(intake['dog-name'])} · {String(intake['dog-breed'])} ·{' '}
        {String(intake['dog-weight-kg'])} kg
      </p>
      <div class="bundas-aside-service">✦ {config.service.name}</div>
      <dl>
        <div>
          <dt>◷ Becsült idő</dt>
          <dd>{formatQuoteDuration(quote)}</dd>
        </div>
        <div>
          <dt>◇ Árbecslés</dt>
          <dd>{formatQuotePrice(quote)}</dd>
        </div>
      </dl>
      <p class="bundas-estimate-note">
        ⓘ A végleges árat a helyszíni állapotfelmérés után erősítjük meg.
      </p>
      <button type="button" class="bundas-text-button" onClick={onEdit}>
        Korábbi lépések módosítása
      </button>
    </aside>
  );
}

export default function DogGroomingBookingFlow({
  mode = 'mock',
  siteSlug = 'bundas-demo',
}: Props) {
  const [step, setStep] = useState<Step>(1);
  const [serviceSlug, setServiceSlug] =
    useState<DogServiceSlug>('full-grooming');
  const [config, setConfig] = useState<PublicPricingConfig | null>(null);
  const [intake, setIntake] = useState<BookingIntakeData>(INITIAL_INTAKE);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [quote, setQuote] = useState<PublicQuoteResponse | null>(null);
  const [days, setDays] = useState<BookingDay[]>([]);
  const [selectedDay, setSelectedDay] = useState(0);
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [dogPhoto, setDogPhoto] = useState<DogPhoto | null>(null);
  const [owner, setOwner] = useState<OwnerData>({
    name: '',
    email: '',
    phone: '',
    notes: '',
    privacy: false,
  });
  const [success, setSuccess] = useState<BookingSuccess | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const selectedDayData = days[selectedDay] ?? null;

  useEffect(() => {
    return () => {
      if (dogPhoto) URL.revokeObjectURL(dogPhoto.previewUrl);
    };
  }, [dogPhoto]);

  function handleDogPhotoChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage('Kérlek, képfájlt válassz (JPG, PNG vagy WEBP).');
      input.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage('A kép legfeljebb 5 MB lehet.');
      input.value = '';
      return;
    }

    setDogPhoto({
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
    });
    input.value = '';
    setMessage('');
  }

  async function fetchConfig(slug: DogServiceSlug) {
    if (mode === 'mock') return createMockPricingConfig(slug);
    const response = await fetch(`/api/booking/${siteSlug}/${slug}/config`);
    if (!response.ok) throw new Error('A szolgáltatás jelenleg nem tölthető be.');
    return (await response.json()) as PublicPricingConfig;
  }

  async function fetchQuote(
    nextConfig: PublicPricingConfig,
    complete: boolean,
  ) {
    if (mode === 'mock') {
      return calculateMockQuote(nextConfig, selectedOptionIds, intake, complete);
    }
    const response = await fetch(
      `/api/booking/${siteSlug}/${nextConfig.service.slug}/quote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIds: selectedOptionIds, intakeData: intake }),
      },
    );
    if (!response.ok) throw new Error('A becslés most nem frissíthető.');
    return (await response.json()) as PublicQuoteResponse;
  }

  async function loadConfig(nextSlug: DogServiceSlug) {
    setStatus('loading');
    setMessage('');
    try {
      const next = await fetchConfig(nextSlug);
      setConfig(next);
      setSelectedOptionIds([]);
      const nextQuote =
        mode === 'mock'
          ? calculateMockQuote(next, [], intake, false)
          : await fetchQuote(next, false);
      setQuote(nextQuote);
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Váratlan hiba történt.');
    }
  }

  useEffect(() => {
    void loadConfig(serviceSlug);
  }, [serviceSlug]);

  useEffect(() => {
    if (!config || step === 1 || step >= 4) return;
    const timer = window.setTimeout(async () => {
      try {
        const nextQuote = await fetchQuote(config, step >= 3);
        setQuote(nextQuote);
        setMessage('');
      } catch (error) {
        if (step >= 3) {
          setMessage(
            error instanceof Error ? error.message : 'A becslés nem frissíthető.',
          );
        }
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [config, intake, selectedOptionIds, step]);

  function updateIntake(slug: string, value: string | number | string[]) {
    setIntake((current) => ({ ...current, [slug]: value }));
    setSlot(null);
    setDays([]);
  }

  function selectSingle(groupSlug: string, optionId: string) {
    if (!config) return;
    const group = config.optionGroups.find((item) => item.slug === groupSlug);
    if (!group) return;
    const groupIds = new Set(group.options.map((item) => item.id));
    setSelectedOptionIds((current) => [
      ...current.filter((id) => !groupIds.has(id)),
      optionId,
    ]);
  }

  function toggleMultiple(optionId: string) {
    setSelectedOptionIds((current) =>
      current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId],
    );
  }

  function groupHasSelection(slug: string) {
    const group = config?.optionGroups.find((item) => item.slug === slug);
    return Boolean(
      group?.options.some((item) => selectedOptionIds.includes(item.id)),
    );
  }

  async function continueFromDetails() {
    if (!config || !groupHasSelection('coat-condition') || !groupHasSelection('desired-result')) {
      setMessage('Válaszd ki a szőrzet állapotát és a kívánt eredményt.');
      return;
    }
    setStatus('loading');
    try {
      const completeQuote = await fetchQuote(config, true);
      setQuote(completeQuote);
      const nextDays =
        mode === 'mock'
          ? createMockSlots(completeQuote.durationMaxMinutes)
          : await fetchLiveSlots(config);
      setDays(nextDays);
      setSelectedDay(0);
      setSlot(null);
      setStep(4);
      setMessage('');
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Nem tölthetők be az időpontok.');
    }
  }

  async function fetchLiveSlots(nextConfig: PublicPricingConfig) {
    const response = await fetch(
      `/api/booking/${siteSlug}/${nextConfig.service.slug}/available-slots`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIds: selectedOptionIds, intakeData: intake }),
      },
    );
    if (!response.ok) throw new Error('A szabad időpontok nem tölthetők be.');
    const payload = (await response.json()) as { slots: BookingDay[] };
    return payload.slots;
  }

  async function submitBooking() {
    if (!config || !quote || !slot) return;
    if (!owner.name.trim() || !owner.email.includes('@') || !owner.phone.trim() || !owner.privacy) {
      setMessage('Töltsd ki a kötelező adatokat és fogadd el az adatkezelést.');
      return;
    }

    setStatus('loading');
    setMessage('');
    try {
      if (mode === 'mock') {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        setSuccess({
          bookingId: `BND-${new Date(slot.start).toISOString().slice(2, 10).replaceAll('-', '')}-${timeLabel(slot.start).replace(':', '')}`,
          slotStart: slot.start,
          slotEnd: slot.end,
        });
      } else {
        const response = await fetch(
          `/api/booking/${siteSlug}/${config.service.slug}/book`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: owner.name,
              email: owner.email,
              phone: owner.phone,
              notes: owner.notes,
              slotStart: slot.start,
              slotEnd: slot.end,
              optionIds: selectedOptionIds,
              intakeData: intake,
              locale: 'hu',
              honeypot: '',
            }),
          },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'A foglalás nem sikerült.');
        setSuccess(payload as BookingSuccess);
      }
      setStep(6);
      setStatus('idle');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'A foglalás nem sikerült.');
    }
  }

  const detailsGroups = useMemo(
    () =>
      config?.optionGroups.filter((group) =>
        ['coat-condition', 'desired-result', 'add-ons'].includes(group.slug),
      ) ?? [],
    [config],
  );

  if (!config || !quote) {
    return (
      <main class="bundas-shell">
        <div class="bundas-loading-card">
          {status === 'error' ? message : 'A foglalási felület betöltése…'}
        </div>
      </main>
    );
  }

  return (
    <main class="bundas-shell">
      <header class="bundas-header">
        <a href="/" class="bundas-logo" aria-label="Bundás főoldal">
          Bundás<span>✣</span>
        </a>
        <ol class="bundas-progress" aria-label="Foglalás lépései">
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            const active = step === number;
            const done = step > number;
            return (
              <li class={active ? 'active' : done ? 'done' : ''} aria-current={active ? 'step' : undefined}>
                <span>{done ? '✓' : number}</span>
                <b>{label}</b>
              </li>
            );
          })}
        </ol>
        <a class="bundas-help" href="tel:+36301234567">
          <span>?</span>
          <small>Segítségre van szükséged?</small>
          <strong>+36 30 123 4567</strong>
        </a>
      </header>

      {mode === 'mock' && (
        <div class="bundas-demo-banner" role="status">
          Demó foglalási felület — valódi foglalás és naptáresemény nem jön létre.
        </div>
      )}

      {step === 1 && (
        <section class="bundas-stage bundas-service-stage">
          <div class="bundas-stage-heading centered">
            <span>Foglalj időpontot</span>
            <h1>Milyen ápolásra van szükségetek?</h1>
            <p>A pontos ár és időtartam a kutyus méretétől és szőrzetétől függ.</p>
          </div>
          <div class="bundas-service-grid">
            {DOG_SERVICES.map((service) => {
              const base = createMockPricingConfig(service.slug).service;
              const selected = service.slug === serviceSlug;
              return (
                <button
                  type="button"
                  class={`bundas-service-card ${service.accent} ${selected ? 'selected' : ''}`}
                  onClick={() => setServiceSlug(service.slug)}
                  aria-pressed={selected}
                >
                  <div class="bundas-service-visual">
                    <span>{service.visual}</span>
                    {service.eyebrow && <em>✦ {service.eyebrow}</em>}
                  </div>
                  <div class="bundas-service-copy">
                    <h2><i>{service.icon}</i>{service.name}</h2>
                    <p>{service.description}</p>
                    <div>
                      <span>◷ {base.baseDurationMinutes}–{base.baseDurationMaxMinutes} perc</span>
                      <strong>{formatHuf(base.basePriceMinor)}-tól</strong>
                      <b>{selected ? '✓' : ''}</b>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <button class="bundas-primary-button" onClick={() => setStep(2)}>
            Tovább a kutyus adataihoz <span>→</span>
          </button>
        </section>
      )}

      {step === 2 && (
        <section class="bundas-stage">
          <div class="bundas-stage-heading centered">
            <span>2. lépés · Kutyusod</span>
            <h1>Ismerjük meg a négylábú vendégünket!</h1>
            <p>Négy rövid adat, és máris pontosabb becslést tudunk adni.</p>
          </div>
          <div class="bundas-dog-card">
            <DogPortrait
              intake={intake}
              photoUrl={dogPhoto?.previewUrl}
              photoName={dogPhoto?.fileName}
              onPhotoChange={handleDogPhotoChange}
            />
            <div class="bundas-dog-form">
              <label>
                Kutyus neve
                <input
                  value={String(intake['dog-name'] ?? '')}
                  onInput={(event) => updateIntake('dog-name', event.currentTarget.value)}
                  placeholder="Például: Mázli"
                />
              </label>
              <label>
                Fajta
                <input
                  value={String(intake['dog-breed'] ?? '')}
                  onInput={(event) => updateIntake('dog-breed', event.currentTarget.value)}
                  placeholder="Például: Cavapoo"
                />
              </label>
              <div class="bundas-form-row">
                <label>
                  Testsúly
                  <div class="bundas-weight-input">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={String(intake['dog-weight-kg'] ?? '')}
                      onInput={(event) =>
                        updateIntake('dog-weight-kg', Number(event.currentTarget.value))
                      }
                      placeholder="8"
                    />
                    <span>kg</span>
                  </div>
                </label>
                <fieldset>
                  <legend>Életkor</legend>
                  <div class="bundas-age-grid">
                    {[
                      ['puppy', 'Kölyök', '0–12 hó'],
                      ['adult', 'Felnőtt', '1–7 év'],
                      ['senior', 'Senior', '7+ év'],
                    ].map(([value, label, caption]) => (
                      <button
                        type="button"
                        class={intake['dog-age-group'] === value ? 'selected' : ''}
                        onClick={() => updateIntake('dog-age-group', value)}
                      >
                        <DogAgeIcon age={value as 'puppy' | 'adult' | 'senior'} />
                        <strong>{label}</strong><small>{caption}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
            <SummaryBar config={config} quote={quote} intake={intake} />
          </div>
          {message && <p class="bundas-error" role="alert">{message}</p>}
          <div class="bundas-actions">
            <button class="bundas-back-button" onClick={() => setStep(1)}>← Vissza</button>
            <button
              class="bundas-primary-button"
              disabled={!isDogStepValid(intake)}
              onClick={() => {
                setMessage('');
                setStep(3);
              }}
            >
              Tovább a részletekhez <span>→</span>
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section class="bundas-stage bundas-details-stage">
          <div class="bundas-stage-heading centered">
            <span>3. lépés · Részletek</span>
            <h1>Állítsuk össze {String(intake['dog-name'])} személyre szabott ápolását!</h1>
            <p>Három gyors választással pontosítjuk az időt és az árbecslést.</p>
          </div>
          <div class="bundas-pet-chip">
            🐕 <strong>{String(intake['dog-name'])}</strong> · {String(intake['dog-breed'])} · {String(intake['dog-weight-kg'])} kg
          </div>
          <div class="bundas-details-grid">
            {detailsGroups.filter((group) => group.slug !== 'add-ons').map((group, groupIndex) => (
              <fieldset class={`bundas-detail-card detail-${groupIndex + 1}`}>
                <legend><span>0{groupIndex + 1}</span>{group.label}</legend>
                {group.options.map((item) => (
                  <label class={selectedOptionIds.includes(item.id) ? 'selected' : ''}>
                    <input
                      type="radio"
                      name={group.slug}
                      checked={selectedOptionIds.includes(item.id)}
                      onChange={() => selectSingle(group.slug, item.id)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <fieldset class="bundas-detail-card detail-3">
              <legend><span>03</span>Amire figyeljünk</legend>
              {config.intakeFields
                .find((field) => field.slug === 'care-considerations')
                ?.options.map((item) => {
                  const selected = Array.isArray(intake['care-considerations'])
                    ? intake['care-considerations'].includes(item.slug)
                    : false;
                  return (
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          const current = Array.isArray(intake['care-considerations'])
                            ? intake['care-considerations'] as string[]
                            : [];
                          updateIntake(
                            'care-considerations',
                            selected
                              ? current.filter((value) => value !== item.slug)
                              : [...current, item.slug],
                          );
                        }}
                      />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              <textarea
                maxLength={120}
                placeholder="Megjegyzés a kozmetikusnak (opcionális)"
                value={String(intake['temperament-notes'] ?? '')}
                onInput={(event) =>
                  updateIntake('temperament-notes', event.currentTarget.value)
                }
              />
            </fieldset>
          </div>
          {detailsGroups.find((group) => group.slug === 'add-ons') && (
            <details class="bundas-addons">
              <summary>✦ Kiegészítő kezelések <span>opcionális</span></summary>
              <div>
                {detailsGroups
                  .find((group) => group.slug === 'add-ons')!
                  .options.map((item) => (
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedOptionIds.includes(item.id)}
                        onChange={() => toggleMultiple(item.id)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
              </div>
            </details>
          )}
          <SummaryBar config={config} quote={quote} intake={intake} />
          {message && <p class="bundas-error" role="alert">{message}</p>}
          <div class="bundas-actions">
            <button class="bundas-back-button" onClick={() => setStep(2)}>← Vissza</button>
            <button class="bundas-primary-button" disabled={status === 'loading'} onClick={continueFromDetails}>
              {status === 'loading' ? 'Időpontok betöltése…' : 'Tovább az időponthoz'} <span>→</span>
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section class="bundas-stage">
          <div class="bundas-two-column">
            <div>
              <div class="bundas-stage-heading">
                <span>4. lépés · Időpont</span>
                <h1>Mikor lenne jó nektek?</h1>
                <p>Válassz egy szabad napot, majd egy időpontot {String(intake['dog-name'])} kezeléséhez.</p>
              </div>
              <div class="bundas-calendar-card">
                <div class="bundas-day-strip" aria-label="Választható napok">
                  {days.slice(0, 7).map((day, index) => (
                    <button
                      class={selectedDay === index ? 'selected' : ''}
                      onClick={() => {
                        setSelectedDay(index);
                        setSlot(null);
                      }}
                    >
                      <span>{dateLabel(day.date, false)}</span>
                      <strong>{new Date(day.date).getDate()}</strong>
                      <i />
                    </button>
                  ))}
                </div>
                <div class="bundas-slot-panel">
                  <h2>{selectedDayData ? dateLabel(selectedDayData.date) : 'Nincs elérhető nap'}</h2>
                  <p>● {selectedDayData?.slots.length ?? 0} szabad időpont</p>
                  <div class="bundas-slot-grid">
                    {selectedDayData?.slots.map((item) => (
                      <button
                        class={slot?.start === item.start ? 'selected' : ''}
                        onClick={() => setSlot(item)}
                      >
                        {timeLabel(item.start)}
                        {slot?.start === item.start && <span>✓</span>}
                      </button>
                    ))}
                  </div>
                  <small>◷ Budapesti idő szerint</small>
                </div>
              </div>
              <div class="bundas-actions">
                <button class="bundas-back-button" onClick={() => setStep(3)}>← Vissza</button>
                <button class="bundas-primary-button" disabled={!slot} onClick={() => setStep(5)}>
                  Tovább az adatokhoz <span>→</span>
                </button>
              </div>
            </div>
            <BookingAside
              config={config}
              quote={quote}
              intake={intake}
              photoUrl={dogPhoto?.previewUrl}
              slot={slot}
              onEdit={() => setStep(3)}
            />
          </div>
        </section>
      )}

      {step === 5 && slot && (
        <section class="bundas-stage">
          <div class="bundas-two-column owner-layout">
            <div>
              <div class="bundas-stage-heading">
                <span>5. lépés · Adatok</span>
                <h1>Már csak egy lépés van hátra</h1>
                <p>Add meg az adataidat, és már csak egy kattintás választ el a foglalásodtól.</p>
              </div>
              <div class="bundas-owner-card">
                <div class="bundas-owner-grid">
                  <label>Név *<input value={owner.name} onInput={(e) => setOwner({ ...owner, name: e.currentTarget.value })} placeholder="Írd be a teljes neved" /></label>
                  <label>E-mail-cím *<input type="email" value={owner.email} onInput={(e) => setOwner({ ...owner, email: e.currentTarget.value })} placeholder="Írd be az e-mail címed" /></label>
                  <label>Telefonszám *<input value={owner.phone} onInput={(e) => setOwner({ ...owner, phone: e.currentTarget.value })} placeholder="+36 30 123 4567" /></label>
                </div>
                <label>Megjegyzés a kozmetikusnak <span>(opcionális)</span>
                  <textarea maxLength={200} value={owner.notes} onInput={(e) => setOwner({ ...owner, notes: e.currentTarget.value })} placeholder="Írd ide, ha van speciális kérésed vagy megjegyzésed" />
                </label>
                <label class="bundas-privacy">
                  <input type="checkbox" checked={owner.privacy} onChange={(e) => setOwner({ ...owner, privacy: e.currentTarget.checked })} />
                  Elfogadom az <a href="/adatkezeles">adatkezelési tájékoztatót</a>. *
                </label>
                {message && <p class="bundas-error" role="alert">{message}</p>}
                <div class="bundas-actions">
                  <button class="bundas-back-button" onClick={() => setStep(4)}>← Vissza</button>
                  <button class="bundas-primary-button" disabled={status === 'loading'} onClick={submitBooking}>
                    {status === 'loading' ? 'Foglalás folyamatban…' : 'Foglalás véglegesítése'} <span>→</span>
                  </button>
                </div>
              </div>
            </div>
            <BookingAside
              config={config}
              quote={quote}
              intake={intake}
              photoUrl={dogPhoto?.previewUrl}
              slot={slot}
              onEdit={() => setStep(3)}
            />
          </div>
        </section>
      )}

      {step === 6 && success && slot && (
        <section class="bundas-success">
          <div class="bundas-success-mark">✓</div>
          <span>Foglalás sikeres</span>
          <h1>Időpontodat rögzítettük!</h1>
          <p>A visszaigazolást elküldtük a(z) {owner.email} címre.</p>
          <div class="bundas-success-card">
            <div class="bundas-success-dog">
              <strong>{dateLabel(success.slotStart)}</strong>
              <b>{timeLabel(success.slotStart)}</b>
              <DogPortrait intake={intake} small photoUrl={dogPhoto?.previewUrl} />
              <p>{String(intake['dog-name'])} · {String(intake['dog-breed'])} · {String(intake['dog-weight-kg'])} kg</p>
            </div>
            <div class="bundas-success-details">
              <h2>✦ {config.service.name}</h2>
              <dl>
                <div><dt>◷ Becsült idő</dt><dd>{formatQuoteDuration(quote)}</dd></div>
                <div><dt>◇ Árbecslés</dt><dd>{formatQuotePrice(quote)}</dd></div>
              </dl>
              <p>ⓘ A végleges árat a helyszíni állapotfelmérés után erősítjük meg.</p>
              <em>✓ Kérjük, érkezz 5 perccel korábban.</em>
            </div>
          </div>
          <div class="bundas-success-actions">
            <a
              href={googleCalendarUrl(success, config.service.name, intake['dog-name'])}
              target="_blank"
              rel="noreferrer"
            >
              ▣ Hozzáadás a naptárhoz
            </a>
            <a href="/">Vissza a főoldalra</a>
          </div>
          <p class="bundas-manage-link">
            {mode === 'mock'
              ? 'Demó módban a módosítási link nem aktív.'
              : 'A módosítási és lemondási linket elküldtük e-mailben.'}
          </p>
          <small>Foglalási azonosító: {success.bookingId}</small>
        </section>
      )}
    </main>
  );
}
