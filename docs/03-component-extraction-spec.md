# Component Extraction Specification

## Goal

Identify which Figma patterns should become Astro components.

Do not componentize every single shape.

## Extraction table

| Pattern | Figma locations | Count | Variants | Astro component | Priority |
|---|---|---:|---|---|---|
| Button | Hero, Services, Pricing, FAQ, Final CTA | 10+ | primary, secondary, accent-primary, accent-secondary, white | `Button.astro` | high |
| EyebrowPill | Hero, Services, Process, Pricing, FAQ, Final CTA | 7 | default (with icon slot) | `EyebrowPill.astro` | high |
| Card | What-LocalUp, Services grid, Pricing, FAQ, Final CTA | 12 | light, warm, dark, accent-green, accent-lavender, dominant | `Card.astro` | high |
| IconBadge | What-LocalUp, Services, Pricing, FAQ | 10+ | light, dark, lime | `IconBadge.astro` | medium |
| CheckItem | Services grid, Pricing lists, Final CTA badges | 15+ | light, dark | `CheckItem.astro` | medium |
| Divider | Services grid, Pricing cards, FAQ sidebar | 6 | horizontal, vertical | `Divider.astro` | low |
| CTAGroup | Hero, Final CTA | 2 | default | `CTAGroup.astro` | low |
| SectionHeader | Hero, Improvements, Services, Process, Pricing, FAQ | 6 | left, center | `SectionHeader.astro` | high |
| ServiceItem | Services included grid | 8 | default | `ServiceItem.astro` | high |
| StepCard | Getting started process | 3 | step-1, step-2, step-3 | `StepCard.astro` | high |
| FAQAccordionItem | FAQ questions list | 6 | default | `FAQAccordionItem.astro` | high |

## Priority values

```txt
high
medium
low
defer
```

## Component categories

### Layout

```txt
Container
Section
SectionHeader
```

### UI

```txt
Button
EyebrowPill
Card
IconBadge
CheckItem
Divider
CTAGroup
```

### Section-specific reusable

```txt
ServiceItem
StepCard
FAQAccordionItem
```

### Visual

```txt
HeroVisual (mockup graphics)
BrowserMockup
ReviewsMockup
EnquiryMockup
```

---

## Detailed Component Specifications

## Button

Figma source: `121:30`, `121:35`, `121:544`, `121:591`, `121:757`, `121:761`

Role: Core interactive trigger for audits and schedules.

Used in: Hero, Services, pricing cards, FAQ sidebar, Final CTA.

Variants:
- `primary`: Dark forest green (`bg-[#01221f]`), white text. Drop shadow small.
- `secondary`: White background, dark border (`border-[#01221f]`), dark text.
- `accent-primary`: Lime green background (`bg-[#eaecb0]`), dark text. Used in Final CTA.
- `accent-secondary`: Transparent background, lime border (`border-[#eaecb0]`), white text. Used in Final CTA.
- `white`: Pure white background, dark charcoal text. Used in lavender CTA bars.

Props / slots:
- `href` (string, optional - if provided, renders as `<a>` instead of `<button>`)
- `variant` ('primary' | 'secondary' | 'accent-primary' | 'accent-secondary' | 'white')
- `slot` (default slot for button text, optional icon slot for arrow)

Tokens:
- color: `--color-bg-dark`, `--color-accent-soft`, `--color-text-inverse`, `--color-text-primary`
- typography: `Geist SemiBold, 14px/16px`
- spacing: `px-[24px] py-[16px]` or `px-[24px] py-[20px]`
- radius: `--radius-md` (12px) or `--radius-sm` (8px)
- shadow: `--shadow-small`

---

## EyebrowPill

Figma source: `121:18`, `121:322`, `121:440`, `121:503`, `121:673`, `121:750`

Role: Decorative category tags above headings.

Used in: Section headers and CTA groups.

Variants:
- `default`: Background `rgba(234, 236, 176, 0.7)` (lime soft) or solid `#eaecb0`, text `#01221f`. Left-side slot for custom SVG icon.

Props / slots:
- `text` (string)
- `slot` (for prefix icon)

Tokens:
- color: `--color-accent-soft`, `--color-text-primary`
- typography: `Geist SemiBold, 11px/13px, uppercase`
- spacing: `px-[16px] py-[8px]`
- radius: `--radius-md` (12px)

---

## Card

Figma source: `121:183`, `121:215`, `121:331`, `121:510`, `121:681`, `121:747`

Role: Container wrapper for sections, feature blocks, and plans.

Variants:
- `light`: White surface, subtle border (`#e5e7eb`), shadow card.
- `warm`: Warm cream surface (`#f7f1e6`), no border.
- `dark`: Forest green surface (`#01221f` / `#15302d`), subtle dark border.
- `accent-green`: Muted light green surface (`#dceccb`), dark green text.
- `accent-lavender`: Soft lavender surface (`#ede7fd` / `#e8e1fc`), subtle border.
- `dominant`: Massive CTA wrapper, Forest green surface, large padding (`p-[80px]`), radius 32px.

Props / slots:
- `variant` ('light' | 'warm' | 'dark' | 'accent-green' | 'accent-lavender' | 'dominant')
- `class` (extra utility classes)
- `slot` (for custom contents)

Tokens:
- color: `--color-bg-card`, `--color-bg-card-warm`, `--color-bg-dark`, `--color-accent-surface`, `--color-accent-lavender`
- radius: `--radius-lg` (16px), `--radius-xl` (20px), `--radius-2xl` (24px), `--radius-3xl` (32px)
- shadow: `--shadow-card`, `--shadow-hero`

---

## IconBadge

Figma source: `121:63`, `121:121`, `121:339`, `121:513`, `121:598`

Role: Icon holder for cards and item headers.

Used in: Services accent card, pricing cards, Hero badges.

Variants:
- `light`: Background `#f0f2e8`, dark forest green icon.
- `dark`: Background `#22423f`, lime green icon.
- `lime`: Background `#e2e67f`, dark forest green icon.

Props / slots:
- `variant` ('light' | 'dark' | 'lime')
- `size` ('sm' | 'md' | 'lg')
- `slot` (for icon SVG)

---

## CheckItem

Figma source: `121:100`, `121:347`, `121:523`, `121:766`

Role: Structured row indicating features, plan items, or audit benefits.

Used in: pricing cards, Final CTA trust rows, services checklist.

Variants:
- `light`: Dark forest green outline box, check icon, dark text.
- `dark`: Dark green filled box with translucent white `rgba(255,255,255,0.1)`, lime check icon, white/translucent text.

Props / slots:
- `text` (string)
- `variant` ('light' | 'dark')

Tokens:
- color: `--color-accent-soft`, `--color-text-primary`, `--color-text-inverse`
- spacing: `gap-[12px]`

---

## FAQAccordionItem

Figma source: `121:707` to `121:740`

Role: Interactive collapsible list item for FAQ rows.

Used in: FAQ section.

Props / slots:
- `index` (number)
- `question` (string)
- `answer` (string)

Interactive behavior:
- Renders as a standard accessible details wrapper:
  ```html
  <details class="group border-b border-[#e5e7eb] py-[24px]">
    <summary class="flex justify-between items-center cursor-pointer list-none">
      <div class="flex gap-[16px] items-center">
        <span class="rounded-[16px] bg-[#f7f1e6] ...">1</span>
        <h3>Question</h3>
      </div>
      <span class="transition-transform group-open:rotate-180">chevron</span>
    </summary>
    <div class="pl-[40px] pt-[16px]">
      <p>Answer text</p>
    </div>
  </details>
  ```

---

## Done checklist
- A task is done only when:
  * Component list mapped in spec
  * HTML structure matched to Figma nodes
  * Variants and slots defined
  * Accessibility options (e.g. details/summary for FAQ) documented
