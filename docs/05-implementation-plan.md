# Implementation Plan

## Phase 0 — Figma MCP extraction

- lock build target
- inspect with Figma MCP
- extract tokens
- extract components
- identify assets
- document exceptions

## Phase 1 — Astro/Tailwind setup check

Verify:

```txt
Astro works
Tailwind is configured
TypeScript works
global CSS imports correctly
font loading strategy is decided
```

Do not add dependencies unless required.

## Phase 2 — Tokens

Implement:

```txt
src/styles/global.css
CSS variables
base body styles
selection/focus styles if needed
```

## Phase 3 — Layout primitives

Create:

```txt
Container.astro
Section.astro
SectionHeader.astro
```

## Phase 4 — UI primitives

Create:

```txt
Button.astro
EyebrowPill.astro
Card.astro
IconBadge.astro
InfoChip.astro
Divider.astro
CTAGroup.astro
```

## Phase 5 — Data file

Create:

```txt
src/data/homepage.ts
```

## Phase 6 — Sections

Create section components in order.

Do not chase pixel-perfect before all sections exist.

## Phase 7 — Visual match pass

Use Figma screenshots and MCP values to align:

```txt
container widths
section spacing
typography
card dimensions
button sizes
visual placements
```

## Phase 8 — Responsive pass

Review:

```txt
375px
768px
1024px
1440px
```

## Phase 9 — QA

Run available commands:

```txt
npm run build
npm run check
npm run lint
```

Use actual project scripts.

## Phase 10 — Project iteration

After v1 exists in code, adjust design/code in the real project instead of endlessly iterating in Figma.
