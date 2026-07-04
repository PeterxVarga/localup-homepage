# Figma MCP Workflow

## Goal

Use Figma MCP to extract the actual design structure and values before implementation.

Do not guess values manually if MCP can inspect them.

## Required Figma setup

Confirm:

```txt
approved homepage build target
cleaned homepage frame
design system page if available
section frames or named groups
reasonably named layers
```

Recommended names:

```txt
Homepage — Build Target v1
Homepage — cleaned system values
LocalUp Design System
```

## Extraction order

### 1. Frame tree

Extract:

```txt
page name
frame name
frame dimensions
section order
major groups
component instances
asset candidates
```

### 2. Tokens

Extract:

```txt
colors
typography
spacing
padding
gaps
radii
shadows
borders
effects
```

Classify each value as:

```txt
official
candidate
merge
exception
needs-review
ignore
```

### 3. Components

Extract repeated patterns:

```txt
buttons
eyebrow pills
cards
chips
icon badges
section headers
service items
process cards
pricing cards
FAQ rows
footer columns
visual graphics
```

### 4. Assets

Identify export candidates:

```txt
hero visual
map pin graphic
review widget
dashboard preview
final CTA graphic
decorative graphics
```

### 5. Implementation notes

For each section, record only technical notes:

```txt
layout type
columns/grid
max width
padding
repeated components
asset needs
responsive behavior
interactive needs
```

No full marketing copy is required here.

## Output

After MCP extraction, update:

```txt
docs/02-token-extraction-spec.md
docs/03-component-extraction-spec.md
docs/04-astro-tailwind-architecture.md
docs/05-implementation-plan.md
```
