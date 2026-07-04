# Asset Export Specification

## Goal

Decide what should be exported from Figma and what should be rebuilt in Astro/Tailwind.

## Rebuild in code

```txt
text
buttons
cards
chips
simple dividers
simple layout
section structure
FAQ accordion
pricing cards
```

## Export as assets

```txt
complex map pin graphics
review widget illustration
hero visual if too complex
dashboard preview if too complex
decorative local signal graphics
generated raster illustrations
```

## Asset table

```md
| Asset name | Figma source | Section | Format | Size | Text baked in? | Alt text | Notes |
|---|---|---|---|---|---|---|---|
```

## Format guidance

```txt
SVG  -> simple vector graphics
PNG  -> transparent complex graphics
WebP -> raster illustrations/photos
AVIF -> optimized photo-like assets if supported
```

## Naming

```txt
hero-local-growth-card.webp
local-signal-pin.webp
review-widget.webp
map-pin-soft-grid.webp
dashboard-preview.webp
```

## Rule

Important text should not be baked into exported images.
