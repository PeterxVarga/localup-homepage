# Token Extraction Specification

Use this file to document exact Figma values and their implementation decisions.

## Decision labels

```txt
official
candidate
merge
exception
needs-review
ignore
```

## Color table

```md
| Figma color | Usage | Frequency | Similar values | Decision | CSS variable |
|---|---|---:|---|---|---|
```

## Typography table

```md
| Figma style | Usage | Similar styles | Decision | Token |
|---|---|---|---|---|
```

## Spacing table

```md
| Value | Usage | Locations | Decision | Token |
|---:|---|---|---|---|
```

## Radius table

```md
| Value | Usage | Locations | Decision | Token |
|---:|---|---|---|---|
```

## Shadow/effect table

```md
| Effect | Usage | Locations | Decision | Token |
|---|---|---|---|---|
```

## Border table

```md
| Border value | Usage | Locations | Decision | Token |
|---|---|---|---|---|
```

## Final CSS variable output

Fill this after extraction:

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

  --radius-sm: ;
  --radius-md: ;
  --radius-lg: ;
  --radius-xl: ;
  --radius-2xl: ;
  --radius-3xl: ;
  --radius-pill: ;

  --shadow-small: ;
  --shadow-card: ;
  --shadow-panel: ;
  --shadow-hero: ;
}
```
