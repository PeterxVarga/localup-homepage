# Astro Coding Agent Build Prompt

```txt
You are implementing the LocalUp homepage in Astro + Tailwind from Figma MCP extraction.

Read first:
- AGENTS.md
- design.md
- structure.md
- docs/01-figma-mcp-workflow.md
- docs/02-token-extraction-spec.md
- docs/03-component-extraction-spec.md
- docs/04-astro-tailwind-architecture.md
- docs/05-implementation-plan.md
- docs/08-qa-checklist.md

Do not redesign.
Do not invent sections.
Do not add fake proof.
Do not hardcode random repeated Figma values.

Implementation order:

1. Create/update `src/styles/global.css` with tokens.
2. Create `src/layouts/BaseLayout.astro`.
3. Create layout primitives:
   - Container.astro
   - Section.astro
   - SectionHeader.astro

4. Create UI primitives:
   - Button.astro
   - EyebrowPill.astro
   - Card.astro
   - IconBadge.astro
   - InfoChip.astro
   - Divider.astro
   - CTAGroup.astro

5. Create `src/data/homepage.ts`.
6. Create section components.
7. Keep `src/pages/index.astro` thin.
8. Implement responsive behavior.
9. Run available build/check commands.

Report:
- files changed
- tokens added
- components created
- assets needed
- unresolved design issues
- QA status
```
