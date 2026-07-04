# LocalUp Technical Design Rules

This file defines how Figma values should be converted into Astro + Tailwind implementation tokens.

It is not a marketing design document.

## Source of truth

The approved Figma build target is the visual source of truth.

Use Figma MCP to extract exact values.

## Grid

Use:

```txt
4px base grid
8px layout rhythm
```

Small UI details may use 4px steps.
Larger layout spacing should use 8px rhythm.

## Spacing scale

Official implementation scale:

```txt
4
8
12
16
20
24
32
40
60
80
100
120
```

Mapping guidance:

```txt
6  -> 8
10 -> 12
14 -> 16
18 -> 20
28 -> 24 or 32
48 -> 40 or 60
64 -> 60 or 80
96 -> reviewed exception or 100
```

## Radius scale

Official implementation scale:

```txt
4
8
12
16
20
24
32
999
```

Usage:

```txt
4px    tiny UI / mockup internals
8px    small badges / compact controls
12px   buttons / chips / small cards
16px   default cards
20px   large cards
24px   panels
32px   hero / final CTA / dominant containers
999px  pills / circles
```

## Typography

Use one primary font family unless the design explicitly requires otherwise.

Preferred:

```txt
Geist
```

Group text styles by role:

```txt
display
section-title
cta-title
card-title-large
card-title
body-large
body
body-small
meta
eyebrow
button
nav
footer-link
```

Do not keep separate styles for tiny accidental differences.

## Color roles

Group colors by role:

```txt
background/page
background/surface
background/card
background/card-warm
background/muted
background/dark

text/primary
text/secondary
text/muted
text/inverse

accent/soft
accent/strong
accent/surface

border/subtle
border/strong
```

Mockup-specific colors may stay isolated and should not become global brand tokens.

## Shadow roles

Use max four depth levels:

```txt
shadow/small
shadow/card
shadow/panel
shadow/hero
```

Decorative blurs/glows should be section-specific or asset-specific, not general-purpose tokens.

## CSS variable naming

Use variables in `src/styles/global.css`.

Example:

```css
:root {
  --color-bg-page: ;
  --color-bg-surface: ;
  --color-bg-card: ;
  --color-bg-card-warm: ;
  --color-bg-muted: ;
  --color-bg-dark: ;

  --color-text-primary: ;
  --color-text-secondary: ;
  --color-text-muted: ;
  --color-text-inverse: ;

  --color-accent-soft: ;
  --color-accent-strong: ;
  --color-accent-surface: ;

  --color-border-subtle: ;
  --color-border-strong: ;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --radius-3xl: 32px;
  --radius-pill: 999px;

  --shadow-small: ;
  --shadow-card: ;
  --shadow-panel: ;
  --shadow-hero: ;
}
```

## Tailwind usage

Prefer:

- CSS variables
- reusable component classes
- semantic component variants
- extracted values from Figma MCP

Avoid:

- repeated `bg-[#...]`
- repeated `rounded-[...]`
- repeated `shadow-[...]`
- arbitrary spacing values copied everywhere

Temporary arbitrary values are allowed during visual matching, but repeated values must be consolidated before completion.
