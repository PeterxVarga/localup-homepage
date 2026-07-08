# LocalUp Audit Booking Flow — V1 Implementation Plan

> **Státusz:** Tervezés  
> **Dátum:** 2026-07-05  
> **Cél:** `/audit` oldal létrehozása 3-lépéses foglalási flow-val, Supabase + Google Calendar integrációval

---

## 0. Architektúra döntések

### 0.1 Rendszerarchitektúra — V4 felé nyitott

```
localup.io              → Astro marketing weboldal + audit funnel  (most)
app.localup.io          → Next.js dashboard / admin / client portal (később)
```

**Elv:** Az Astro a **publikus weboldal + konverziós funnel** helye. A booking logika **framework-semleges lib rétegben** él, amit később a Next.js dashboard is használhat. A Supabase a **közös source of truth**.

### 0.2 Astro mód

A projekt jelenleg **static** módban fut. Az audit flow-hoz SSR kell a következők miatt:
- API route-ok a slot generáláshoz és booking submit-hez
- Google Calendar API hívások (szerver oldalon)
- Supabase DB műveletek (szerver oldalon)
- Email küldés Resend-del

**Döntés:** Átállás **SSR módra**, deployment targettól függő adapterrel.

| Deployment | Adapter | Parancs |
|---|---|---|
| **Vercel** | `@astrojs/vercel` | `npx astro add vercel` |
| **Self-hosted / Node** | `@astrojs/node` | `npx astro add node` |

`astro.config.mjs` frissítése (példa Vercel-re):
```js
import vercel from '@astrojs/vercel';
export default defineConfig({
  output: 'server',
  adapter: vercel(),
});
```

### 0.3 Interaktivitás kezelése

A `/audit` oldal egy több-lépéses form. Astro-ban erre:

| Megoldás | Előny | Hátrány |
|---|---|---|
| **Preact island** | Komponens alapú, state management | Extra függőség |
| **Sima JS + Astro** | Nincs extra függőség | Több manuális DOM kezelés |

**Döntés:** **Preact island** a form flow-hoz (legkisebb React-kompatibilis runtime).

```sh
npx astro add preact
```

### 0.4 Függőségek

```
npm install @supabase/supabase-js googleapis resend zod date-fns-tz
```

### 0.5 Lib réteg — framework-semleges

**Szabály:** A booking + tracking + calendar + email logika **ne** az Astro route fájlokban éljen. Legyen külön `lib/` réteg, amit az Astro endpoint-ok csak meghívnak.

```
lib/
  booking/
    createBooking.ts      — DB insert + validáció
    generateSlots.ts      — slot generálás (már meglévő lib/audit/slots.ts)
    trackEvent.ts         — event mentés booking_events-be
  calendar/
    createCalendarEvent.ts
    getFreeBusy.ts
  email/
    sendBookingConfirmation.ts
    sendAdminNotification.ts
```

**Előny:** Később a Next.js dashboard ugyanezeket a függvényeket tudja hívni (vagy átmásolni) a saját route-jából.

### 0.6 Adatmodell — jövőbiztos

A `audit_bookings` tábla most is tartalmazzon általánosítható mezőket:

```sql
booking_type TEXT DEFAULT 'localup_audit',  -- később más típusú booking is lehet
source TEXT DEFAULT 'website',              -- website | dashboard | admin | api
funnel TEXT DEFAULT 'audit',                -- melyik funnel hozta
session_id UUID,                            -- session szintű tracking
```

Így a Next.js dashboard később ugyanebből az adatból tud dolgozni, nem kell migráció.

---

## 1. Fájlstruktúra

```
src/
  pages/
    index.astro                     # homepage (CTA linkek frissítése)
    audit.astro                     # /audit oldal - vékony wrapper
    api/
      audit/
        available-slots.ts          # GET: slot generálás + freeBusy check
        book.ts                     # POST: booking submit

  components/
    audit/
      AuditBookingFlow.tsx          # Preact island - teljes flow state management
      ProgressIndicator.tsx         # 1 → 2 → 3 step indicator
      StepBusiness.tsx              # Step 1: Business basics
      StepGoals.tsx                 # Step 2: Goals
      StepTime.tsx                  # Step 3: Slot + contact
      StepConfirmation.tsx          # Confirmation screen
      GoalPill.tsx                  # Választható goal pill/button
      TimeSlotButton.tsx            # Idősáv gomb
      DayPicker.tsx                 # Napválasztó

  lib/
    audit/
      config.ts                     # Availability config, constants
      validation.ts                 # Zod schemas (megosztott)

    booking/
      createBooking.ts              # DB insert + üzleti logika (framework-semleges)
      generateSlots.ts              # Slot generáló + freeBusy szűrés
      trackEvent.ts                 # Event mentés booking_events-be

    calendar/
      createCalendarEvent.ts        # Google Calendar event létrehozás
      getFreeBusy.ts                # freeBusy query

    email/
      sendBookingConfirmation.ts    # User confirmation email
      sendAdminNotification.ts      # Admin notification email

    supabase.ts                     # Supabase client (szerver oldali)

  data/
    audit-content.ts                # Audit oldal szöveges tartalma
```

---

## 2. Adatbázis séma (Supabase)

### 2.1 `audit_bookings`

```sql
CREATE TABLE audit_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Step 1
  business_name TEXT NOT NULL,
  website_url TEXT,
  no_website BOOLEAN DEFAULT FALSE,
  city TEXT NOT NULL,
  business_type TEXT NOT NULL,

  -- Step 2
  goals JSONB NOT NULL,              -- ["more_visibility", "more_calls", ...]
  notes TEXT,

  -- Step 3
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,

  -- Slot
  selected_slot_start TIMESTAMPTZ NOT NULL,
  selected_slot_end TIMESTAMPTZ NOT NULL,

  -- Google Calendar
  google_calendar_event_id TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'calendar_pending',
  -- V1: calendar_pending | booked | calendar_failed | cancelled | completed | no_show

  -- Future-compatible (V4 dashboard)
  booking_type TEXT NOT NULL DEFAULT 'localup_audit',
  source TEXT NOT NULL DEFAULT 'website',
  funnel TEXT NOT NULL DEFAULT 'audit',
  session_id UUID,

  -- Tracking
  source_url TEXT,
  cta_location TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_bookings_email ON audit_bookings(email);
CREATE INDEX idx_audit_bookings_status ON audit_bookings(status);
CREATE INDEX idx_audit_bookings_slot ON audit_bookings(selected_slot_start);

-- Race condition védelem: ugyanazt a slotot ne lehessen kétszer lefoglalni
-- calendar_failed is benne van, mert ilyenkor a lead értékes, admin manuálisan kezeli
CREATE UNIQUE INDEX unique_audit_booking_slot
  ON audit_bookings(selected_slot_start)
  WHERE status IN ('calendar_pending', 'booked', 'calendar_failed');

-- Erősebb védelem: átfedő slotok ellen (opcionális, btree_gist extension kell)
-- CREATE EXTENSION IF NOT EXISTS btree_gist;
-- ALTER TABLE audit_bookings
-- ADD CONSTRAINT no_overlapping_audit_bookings
-- EXCLUDE USING gist (
--   tstzrange(selected_slot_start, selected_slot_end, '[)') WITH &&
-- ) WHERE (status IN ('calendar_pending', 'booked', 'calendar_failed'));
```

### 2.2 `booking_events`

```sql
CREATE TABLE booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,           -- minden event ugyanazzal a session_id-val
  booking_id UUID REFERENCES audit_bookings(id),  -- NULL amíg nincs submit
  event_name TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_booking_events_booking ON booking_events(booking_id);
```

---

## 3. API route-ok

### 3.1 `GET /api/audit/available-slots`

**Query:** `?timezone=Europe/Budapest&days=14`

**Logika (sorrendben):**
1. Generálja az összes lehetséges slotot `config.ts` alapján
2. Kiszűri a már foglalt slotokat (Supabase query)
3. Kiszűri a Google Calendar freeBusy ütközéseket
4. Csak szabad slotokat ad vissza

**Válasz:**
```json
{
  "slots": [
    {
      "date": "2026-07-09",
      "dayName": "Thursday",
      "slots": [
        { "start": "2026-07-09T10:00:00+02:00", "end": "2026-07-09T10:30:00+02:00" }
      ]
    }
  ]
}
```

### 3.2 `POST /api/audit/book`

**Logika (sorrendben, szerver oldalon):**

1. **Zod validáció** — minden mező
2. **Slot újraellenőrzés** — DB-ből + freeBusy, hogy nem foglalt-e időközben
3. **DB insert** — `audit_bookings` táblába, **status = `calendar_pending`**
   - A `unique_audit_booking_slot` unique index itt fogja meg a race conditiont
4. **Google Calendar event létrehozás** (OAuth refresh token-nel)
   - Cím: `LocalUp Audit Call — {businessName}`
   - Leírás: összes booking adat + tracking info
   - Attendee: user email (opcionális, OAuth esetén működik)
5. Sikeres GC esetén: **UPDATE status = `booked`** + `google_calendar_event_id` mentése
6. Sikertelen GC esetén: **UPDATE status = `calendar_failed`**, admin értesítés
7. **Email küldés** — User confirmation (csak `booked` statusnál) + Admin notification (mindig)
8. **Tracking event** — `booking_events` táblába

**Hibakezelés:**
- Slot race condition → DB unique constraint fogja meg → `slot_taken` hiba
- Calendar fail → `calendar_failed` status, a booking megmarad, admin kap értesítést
- Email fail → log + retry, a booking attól még `booked` marad

**Rate limit / spam védelem:**
- IP-alapú rate limit a `/api/audit/book` route-on (max 3 POST / perc / IP)
- Honeypot mező a formban (hidden input, botok töltik ki → ha ki van töltve, eldobjuk)
- Később opcionálisan Cloudflare Turnstile

---

## 4. Komponens fa

```
/pages/audit.astro
  └── BaseLayout
        └── <main>
              └── AuditBookingFlow (Preact island)
                    ├── ProgressIndicator
                    │     ├── Step 1: Business
                    │     ├── Step 2: Goals
                    │     └── Step 3: Time
                    │
                    ├── StepBusiness        (step=1)
                    │     ├── Input: businessName
                    │     ├── Input: websiteUrl
                    │     ├── Checkbox: noWebsite
                    │     ├── Input: city
                    │     ├── Select: businessType
                    │     └── CTA: Continue
                    │
                    ├── StepGoals           (step=2)
                    │     ├── GoalPill[] (multi-select)
                    │     ├── Textarea: notes
                    │     └── CTA: Choose a time
                    │
                    ├── StepTime            (step=3)
                    │     ├── DayPicker
                    │     ├── TimeSlotButton[]
                    │     ├── Input: name, email, phone
                    │     └── CTA: Book free audit
                    │
                    └── StepConfirmation    (step=done)
                          ├── Booking details card
                          ├── "What happens next"
                          └── CTA: Back to homepage
```

---

## 5. Flow vizuális leírás

### 5.1 Progress Indicator

```
 ●━━━━━━●━━━━━━○
 1       2       3
Business  Goals   Time
```

- Befejezett: `bg-bg-dark` teli kör
- Aktuális: `bg-accent-strong` teli kör
- Jövőbeli: `bg-border-subtle` üres kör
- Visszalépés: korábbi step-ekre kattintva

### 5.2 Step 1 — Business basics

- **Cím:** Tell us about your business
- **Subcopy:** We'll use this to review your local presence before the call.
- **Mezők:** business name*, website URL + "I don't have a website" checkbox, city*, business type dropdown*
- **CTA:** Continue →
- **Alsó infó:** ⏱ Takes about 60–90 seconds
- **Tracking:** Step 1 completion után `audit_step_1_completed` event + **draft lead** mentése a `booking_events` táblába (business_name, city, business_type, cta_location, utm, session_id). Így látható a drop-off akkor is, ha a user nem fejezi be a flow-t.

### 5.3 Step 2 — Goals

- **Cím:** What should we look at first?
- **Subcopy:** Choose the areas you want to improve. You can select more than one.
- **Goal pill-ek:** Nagy kártyaszerű gombok (nem checkbox-ok):
  - 📍 More local visibility
  - 📞 More calls / bookings
  - 🖥 Better website
  - ⭐ More reviews
  - 🤔 Not sure yet
- Kiválasztva: `bg-accent-soft/30 border border-accent-strong` + pipa
- **Textarea:** Anything we should know? (opcionális)
- **CTA:** Choose a time →

### 5.4 Step 3 — Slot + contact

- **Cím:** Choose your audit call time
- **Subcopy:** Pick a time that works for you. We'll review your website, local visibility, and trust signals before the call.
- **Day picker:** 7 napos vízszintes sáv, slot-os napok kattinthatók
- **Time slot gombok:** Grid, 2-3 oszlop, kiválasztva `bg-bg-dark text-white`
- **Időzóna:** Automata detektálás + megjelenítés
- **Kapcsolati mezők:** name*, email*, phone (opcionális)
- **CTA:** Book free audit

### 5.5 Confirmation

- **Cím:** Your audit call is booked ✅
- **Leírás:** We'll review your website, local visibility, and trust signals before the call...
- **Booking details kártya:** business, date, time, goals, email
- **CTA:** ← Back to homepage
- **Megerősítés:** 📧 Confirmation email sent

---

## 6. Design system integráció

### 6.1 Token használat

| Token | Hol |
|---|---|
| `--color-bg-page` | Oldal háttér |
| `--color-bg-card` | Form kártya, input mezők |
| `--color-bg-muted` | Alap goal pill, skeleton |
| `--color-bg-dark` | Kiválasztott slot/nap, primary CTA |
| `--color-bg-card-warm` | Confirmation kártya |
| `--color-accent-soft` | Kiválasztott goal pill bg |
| `--color-accent-strong` | Goal pill keret, progress dot |
| `--color-bg-icon-dark` | Badge-ek sötét háttéren |
| `--radius-xl` (20px) | Form kártya |
| `--radius-lg` (16px) | Input mezők |
| `--radius-md` (12px) | Gombok, goal pill-ek |
| `--shadow-card` | Form kártya |

### 6.2 Tipográfia

| Stílus | Méret | Használat |
|---|---|---|
| Section title | 36-40px Medium | Step címek |
| Card title | 20px Semibold | Confirmation cím |
| Body large | 18px | Leírások |
| Body | 15px | Label-ek, goal szöveg |
| Body small | 14px | Segéd szöveg |
| Button | 16px Semibold | Minden CTA |

---

## 7. Validáció (Zod)

```ts
// lib/audit/validation.ts
import { z } from 'zod';

export const businessStepSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  websiteUrl: z.string().url('Please enter a valid URL').optional().or(z.literal('')),
  noWebsite: z.boolean(),
  city: z.string().min(1, 'City or service area is required'),
  businessType: z.string().min(1, 'Please select your business type'),
}).refine(
  data => data.noWebsite || (data.websiteUrl && data.websiteUrl.length > 0),
  {
    message: 'Enter your website URL or select "I don\'t have a website"',
    path: ['websiteUrl'],
  }
);

export const goalsStepSchema = z.object({
  goals: z.array(z.string()).min(1, 'Select at least one area to improve'),
  notes: z.string().optional(),
});

export const timeStepSchema = z.object({
  name: z.string().min(1, 'Your name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  slotStart: z.string().min(1, 'Please select a time slot'),
  slotEnd: z.string().min(1),
});
```

---

## 8. Google Calendar — OAuth refresh token setup

**Miért OAuth, nem service account:**
- Service account esetén az event-ek a service account tulajdonában lesznek, nem a tiédben
- Attendee invite-hoz domain-wide delegation kellene
- OAuth refresh token-nel a saját naptáradba írsz, természetesebben működik

**Setup lépések:**
1. Google Cloud Console → API & Services → OAuth consent screen (belső használat)
2. Credentials → Create OAuth 2.0 Client ID (Web application)
3. Refresh token generálása (egyszeri, pl. OAuth Playground-dal):
   - Scope: `https://www.googleapis.com/auth/calendar`
   - A kapott refresh token nem jár le, amíg vissza nem vonod

```ts
// lib/google-calendar.ts
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  import.meta.env.GOOGLE_CLIENT_ID,
  import.meta.env.GOOGLE_CLIENT_SECRET,
);
oauth2Client.setCredentials({
  refresh_token: import.meta.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const CALENDAR_ID = import.meta.env.GOOGLE_CALENDAR_ID || 'primary';
```

---

## 9. Konfiguráció

```ts
// lib/audit/config.ts
export const availabilityConfig = {
  timezone: 'Europe/Budapest',
  slotDurationMinutes: 30,
  bufferMinutes: 15,
  minAdvanceHours: 24,
  maxAdvanceDays: 14,
  weeklySchedule: [
    { weekday: 1, start: '10:00', end: '12:00' },
    { weekday: 2, start: '14:00', end: '17:00' },
    { weekday: 4, start: '10:00', end: '15:00' },
  ],
};

export const businessTypes = [
  'Home services (plumbing, HVAC, electrical, cleaning)',
  'Construction & trades (roofing, contracting, landscaping)',
  'Health & wellness (dentist, medical, therapy, fitness)',
  'Beauty & personal care (salon, barber, spa)',
  'Professional services (legal, real estate, tutoring)',
  'Automotive (repair, body shop, detailing)',
  'Pet services (grooming, veterinary, daycare)',
  'Other local service',
];

export const goalOptions = [
  { id: 'more_visibility', label: 'More local visibility' },
  { id: 'more_calls', label: 'More calls / bookings' },
  { id: 'better_website', label: 'Better website' },
  { id: 'more_reviews', label: 'More reviews' },
  { id: 'not_sure', label: 'Not sure yet' },
];
```

---

## 10. Időzóna és dátumkezelés

**Alapelvek:**
- **Source timezone:** `Europe/Budapest` — az availability config ebben van definiálva
- **DB storage:** minden `TIMESTAMPTZ` UTC-ben tárolódik (Supabase automatikusan konvertál)
- **UI display:** a felhasználó saját időzónájában jelenik meg

**Slot generálás:**
- `lib/audit/slots.ts` a `date-fns-tz` könyvtárat használja (nem kézi string parse-olás)
- Az availability config-ban megadott időpontok (`10:00`, `14:00`) a source timezone-ban értendők
- A generált slotok ISO 8601 formátumban, timezone offset-tel kerülnek visszaadásra
- Nincs `new Date(string)` parse-olás — minden dátumkezelés `date-fns-tz`-vel történik

**UI megjelenítés:**
- `Intl.DateTimeFormat().resolvedOptions().timeZone` a user időzónájának detektálásához
- Slot időpontok a user időzónájában formázva
- Időzóna egyértelműen feltüntetve: "Times shown in Eastern Time (UTC-5)"

**Függőség:**
```sh
npm install date-fns-tz
```

---

## 11. Hibaállapotok

| Hiba | Felhasználói üzenet | Technikai |
|---|---|---|
| Érvénytelen mező | "Please enter your business name" | Zod → field error |
| Nincs slot | "No available slots in the next 14 days." | API üres tömb |
| Slot foglalt | "That time was just taken. Please choose another." | DB + freeBusy re-check |
| DB fail | "Something went wrong. Please try again." | 500, log |
| Calendar fail | "Booked but calendar sync pending — we'll reach out." | status: `calendar_failed` |
| Email fail | (rejtett) | Log, retry |
| Dupla submit | "Already being booked. Please wait..." | Button disabled |

---

## 12. Tracking event-ek

```
audit_cta_clicked          — CTA klikk a homepage-ről
audit_flow_started         — /audit oldal betöltés (session_id generálás)
audit_step_1_completed     — Step 1 → Step 2 (draft lead mentése: business_name, city, business_type)
audit_step_2_completed     — Step 2 → Step 3 (goals mentése a draft-hoz)
audit_slot_selected        — Slot kiválasztva
audit_booking_submitted    — Submit gomb megnyomva
audit_booking_confirmed    — Sikeres booking (booking_id összekötése a session-nel)
audit_booking_failed       — Sikertelen booking
```

Minden event tartalmazza: `session_id`, `cta_location`, `source_url`, UTM paraméterek, `selected_goals`, `business_type`, `city`.

**Draft lead logika:** Step 1 után a `booking_events` táblába kerül egy `audit_step_1_completed` event a `business_name`, `city`, `business_type` értékekkel és egy `session_id`-val. Ha a user később submitol, a `booking_id` hozzákapcsolódik. Ha nem, a drop-off látható a funnel-ben.

---

## 13. Környezeti változók

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Google Calendar — OAuth refresh token
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_REFRESH_TOKEN=1//xxxx
GOOGLE_CALENDAR_ID=primary

RESEND_API_KEY=re_...

PUBLIC_SITE_URL=https://localup.io
```

---

## 14. Implementációs sorrend (V1)

| # | Feladat | Függőség |
|---|---|---|
| 1 | `@astrojs/node` + `@astrojs/preact` telepítés, SSR konfig | — |
| 2 | Supabase projekt létrehozás, táblák, env változók | 1 |
| 3 | `lib/supabase.ts`, `lib/google-calendar.ts`, `lib/email.ts` | 2 |
| 4 | `lib/audit/config.ts`, `lib/audit/validation.ts`, `lib/audit/slots.ts` | — |
| 5 | `GET /api/audit/available-slots` | 3, 4 |
| 6 | `POST /api/audit/book` | 3, 4 |
| 7 | `pages/audit.astro` — layout, BaseLayout wrapper | 1 |
| 8 | `AuditBookingFlow.tsx` — fő state machine | 7 |
| 9 | `ProgressIndicator.tsx` | 8 |
| 10 | `StepBusiness.tsx` | 8, 9 |
| 11 | `StepGoals.tsx` + `GoalPill.tsx` | 8, 9 |
| 12 | `StepTime.tsx` + `DayPicker.tsx` + `TimeSlotButton.tsx` | 5, 8, 9 |
| 13 | `StepConfirmation.tsx` | 6, 8 |
| 14 | Homepage CTA linkek frissítése (`?cta_location=...`) | 7 |
| 15 | `lib/audit/tracking.ts` integrálása minden step-be | 2 |
| 16 | Tesztelés: teljes flow, hibakezelés, mobile, email | 6, 13 |

---

## 15. Acceptance criteria

- [x] *(terv szinten)* A homepage CTA-k a `/audit` oldalra visznek
- [x] *(terv szinten)* A `/audit` oldal LocalUp design system-ben készül
- [x] *(terv szinten)* A 3-step flow működik
- [x] *(terv szinten)* Konkrét slot választás
- [x] *(terv szinten)* Supabase mentés
- [x] *(terv szinten)* Google Calendar integráció
- [x] *(terv szinten)* Email küldés (user + admin)
- [x] *(terv szinten)* Tracking event-ek
- [x] *(terv szinten)* Mobile responsive
- [x] *(terv szinten)* Backend slot collision check
- [x] *(terv szinten)* Error/loading/success state-ek
