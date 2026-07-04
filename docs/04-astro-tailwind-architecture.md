# Astro + Tailwind Architecture

## Goal

Build a static, maintainable, fast homepage using Astro components, Tailwind utilities, and CSS variables extracted from Figma.

## Folder structure

```txt
src/
  pages/
    index.astro
  layouts/
    BaseLayout.astro
  components/
    layout/
    ui/
    sections/
    visuals/
  data/
    homepage.ts
  styles/
    global.css
public/
  assets/
```

## Astro component style

Use `.astro` components for static homepage sections.

Use frontmatter for imports and data.

Example:

```astro
---
import Button from "../ui/Button.astro";

interface Props {
  title: string;
  description?: string;
}

const { title, description } = Astro.props;
---

<section>
  <h2>{title}</h2>
  {description && <p>{description}</p>}
  <Button variant="primary">Get your free audit</Button>
</section>
```

## Props and slots

Use props for structured values:

```astro
<SectionHeader eyebrow="FAQ" title="Questions before you start?" />
```

Use slots for flexible content:

```astro
<Card variant="light">
  <slot />
</Card>
```

## Tailwind strategy

Use Tailwind for layout and utilities.

Use CSS variables for design tokens.

Example:

```astro
<div class="rounded-[var(--radius-lg)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)]">
  <slot />
</div>
```

Repeated arbitrary values should be replaced with component classes or variables.

## Global styles

`src/styles/global.css` should include:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* tokens */
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--color-bg-page);
  color: var(--color-text-primary);
}
```

## Base layout

`BaseLayout.astro` should handle:

- HTML shell
- metadata
- global stylesheet import
- font setup
- page wrapper

## Content data

Use `src/data/homepage.ts`.

Do not create a CMS or content collection unless explicitly needed.

## Interactivity

Astro is static by default.

Only add client-side JS where needed.

FAQ accordion options:

1. Use native `<details>` / `<summary>` for simple accessible behavior.
2. Use minimal client-side script only if custom interaction is required.
3. Avoid heavy React islands unless necessary.

## Icons

Use one icon strategy:

- inline SVG components
- lucide icons if already installed
- exported SVG assets

Do not mix many icon libraries.

## Images

Use optimized assets from `public/assets`.

If using Astro image tooling later, keep the asset naming and alt text clear.

## Build priorities

1. correct structure
2. token consistency
3. responsive behavior
4. Figma visual similarity
5. polish
