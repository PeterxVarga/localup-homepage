# Agent Guide

## Role

You are implementing the LocalUp homepage in an Astro + Tailwind codebase using Figma MCP as the primary design source.

Do not redesign the page.
Do not invent new sections.
Do not add fake proof.
Do not copy random Figma values directly into components.

## Source order

Use these sources in this order:

1. Figma MCP data from the approved build target frame
2. `design.md`
3. `structure.md`
4. `docs/01-figma-mcp-workflow.md`
5. `docs/02-token-extraction-spec.md`
6. `docs/03-component-extraction-spec.md`
7. `docs/04-astro-tailwind-architecture.md`
8. exported assets / reference images
9. existing project code

If sources conflict:

- Figma MCP wins for exact visual values.
- `design.md` wins for token consolidation.
- `structure.md` wins for architecture.
- Accessibility and responsiveness may override exact desktop Figma layout.

## Target stack

Use:

- Astro
- TypeScript
- Tailwind CSS
- local content/data files
- no CMS by default
- no Storyblok
- minimal dependencies

## Implementation rules

- Use Astro components for sections and UI primitives.
- Keep `src/pages/index.astro` thin.
- Put reusable UI in `src/components/ui`.
- Put section components in `src/components/sections`.
- Put layouts in `src/layouts`.
- Put editable homepage data in `src/data/homepage.ts`.
- Put global styles and CSS variables in `src/styles/global.css`.
- Export complex visuals from Figma when rebuilding them in code is not worth it.
- Keep important text editable, not baked into images.
- Do not use random repeated arbitrary Tailwind values.
- Promote repeated values to CSS variables or Tailwind tokens.

## LocalUp visual implementation rules

Use the extracted Figma values, but preserve this direction:

- warm ivory / cream backgrounds
- deep forest green / charcoal text
- muted lime-sage accents
- rounded cards
- soft shadows
- calm premium layout
- service-led homepage
- dashboard/client view only as progress visibility

Avoid:

- generic SEO agency visuals
- fake logos
- fake testimonials
- fake ratings as real proof
- fake case studies
- guaranteed results
- unsupported performance claims
- heavy dashboard/SaaS framing

## Done checklist

A task is done only when:

- code uses tokens/components instead of copied random values
- page structure is split into Astro components
- content is editable
- responsive behavior works
- no fake proof was introduced
- Figma comparison was performed
- build passes
