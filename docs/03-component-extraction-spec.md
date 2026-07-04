# Component Extraction Specification

## Goal

Identify which Figma patterns should become Astro components.

Do not componentize every single shape.

## Extraction table

```md
| Pattern | Figma locations | Count | Variants | Astro component | Priority |
|---|---|---:|---|---|---|
```

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
InfoChip
Divider
CTAGroup
```

### Section-specific reusable

```txt
FeatureCard
ServiceItem
ProcessCard
ProcessConnector
PricingCard
FAQAccordionItem
FooterColumn
```

### Visual

```txt
HeroVisual
LocalSignalGraphic
ReviewGraphic
MapPinGraphic
DashboardPreview
```

## Component spec template

```md
## ComponentName

Figma source:
...

Role:
...

Used in:
...

Variants:
...

Props / slots:
...

Tokens:
- color:
- typography:
- spacing:
- radius:
- shadow:

Responsive behavior:
...

Implementation notes:
...

Do not:
...
```

## Rules

- Prefer variants over duplicated components.
- Avoid huge over-flexible components.
- Keep business data outside UI primitives.
- Use slots for flexible Astro composition.
- Export complex visuals as assets when appropriate.
