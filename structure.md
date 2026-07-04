# Astro + Tailwind Project Structure

## Target structure

```txt
src/
  pages/
    index.astro

  layouts/
    BaseLayout.astro

  components/
    layout/
      Container.astro
      Section.astro
      SectionHeader.astro

    ui/
      Button.astro
      EyebrowPill.astro
      Card.astro
      IconBadge.astro
      InfoChip.astro
      Divider.astro
      CTAGroup.astro

    sections/
      HeroSection.astro
      WhatLocalUpImprovesSection.astro
      ServicesIncludedSection.astro
      GettingStartedSection.astro
      PlansSection.astro
      FAQSection.astro
      FinalCTASection.astro
      Footer.astro

    visuals/
      HeroVisual.astro
      LocalSignalGraphic.astro
      ReviewGraphic.astro
      MapPinGraphic.astro

  data/
    homepage.ts

  styles/
    global.css

public/
  assets/
    images/
    icons/
```

## Astro page rule

`src/pages/index.astro` should stay thin.

It should import and compose section components.

Example:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import HeroSection from "../components/sections/HeroSection.astro";
import WhatLocalUpImprovesSection from "../components/sections/WhatLocalUpImprovesSection.astro";
import ServicesIncludedSection from "../components/sections/ServicesIncludedSection.astro";
import GettingStartedSection from "../components/sections/GettingStartedSection.astro";
import PlansSection from "../components/sections/PlansSection.astro";
import FAQSection from "../components/sections/FAQSection.astro";
import FinalCTASection from "../components/sections/FinalCTASection.astro";
import Footer from "../components/sections/Footer.astro";
---

<BaseLayout>
  <main>
    <HeroSection />
    <WhatLocalUpImprovesSection />
    <ServicesIncludedSection />
    <GettingStartedSection />
    <PlansSection />
    <FAQSection />
    <FinalCTASection />
    <Footer />
  </main>
</BaseLayout>
```

## Component responsibilities

### Layout components

`Container.astro`
- max width
- horizontal padding
- alignment

`Section.astro`
- semantic section wrapper
- vertical spacing variants
- background variants

`SectionHeader.astro`
- eyebrow
- title
- description
- alignment variants

### UI components

`Button.astro`
- primary / secondary / inverse / text variants

`EyebrowPill.astro`
- section labels
- optional icon slot

`Card.astro`
- light / warm / muted / dark variants

`IconBadge.astro`
- repeated icon container

`InfoChip.astro`
- timing/status/meta chips

`Divider.astro`
- consistent dividers

`CTAGroup.astro`
- button pairs

### Section components

Section components compose layout/UI primitives and data from `src/data/homepage.ts`.

Do not hide large data arrays inside section components.

## Data file

Use `src/data/homepage.ts` for editable data.

Example:

```ts
export const homepage = {
  nav: [],
  hero: {},
  features: [],
  services: [],
  process: [],
  plans: [],
  faqs: [],
  footer: {},
} as const;
```

## Asset handling

Use code for:

- text
- layout
- cards
- buttons
- chips
- simple icons
- accordion UI

Use exported assets for:

- complex generated visuals
- map pin graphics
- review widget graphics
- dashboard preview visuals
- decorative background graphics

Important text must remain editable HTML.
