# QA Checklist

## Figma/MCP

- [ ] build target inspected
- [ ] tokens extracted
- [ ] components extracted
- [ ] assets listed
- [ ] exceptions documented

## Astro architecture

- [ ] `src/pages/index.astro` is thin
- [ ] `BaseLayout.astro` exists
- [ ] layout components exist
- [ ] UI primitives exist
- [ ] section components exist
- [ ] data file exists
- [ ] global CSS tokens exist

## Tailwind/token consistency

- [ ] no repeated random arbitrary colors
- [ ] no repeated random radius values
- [ ] no repeated random shadows
- [ ] spacing follows 4px/8px system
- [ ] typography uses one font system

## Responsive

- [ ] 375px checked
- [ ] 768px checked
- [ ] 1440px checked
- [ ] no horizontal overflow
- [ ] cards stack correctly
- [ ] visuals scale correctly

## Accessibility

- [ ] semantic headings
- [ ] buttons/links correct
- [ ] FAQ accessible
- [ ] focus states visible
- [ ] alt text reviewed
- [ ] contrast reviewed

## Content/proof

- [ ] no fake proof introduced
- [ ] placeholder logos reviewed
- [ ] placeholder testimonials reviewed
- [ ] placeholder prices reviewed
- [ ] unsupported claims removed or softened

## Build

- [ ] build passes
- [ ] no console errors
- [ ] no broken assets
