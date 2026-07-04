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

| Figma color | Usage | Frequency | Similar values | Decision | CSS variable |
|---|---|---:|---|---|---|
| `#fffffe` | Page background | High | `#ffffff` | official | `--color-bg-page` |
| `#f7f1e6` | Warm card background, review widgets | Medium | `#f7f3eb` | official | `--color-bg-card-warm` |
| `#f0f2e8` | Muted background, icon container bg | Medium | | official | `--color-bg-muted` |
| `#01221f` | Dark card background, primary buttons | High | | official | `--color-bg-dark` |
| `#020c0b` | Headings, primary text | High | | official | `--color-text-primary` |
| `rgba(2, 12, 11, 0.7)` | Secondary body text | High | `#4b5563` | official | `--color-text-secondary` |
| `rgba(2, 12, 11, 0.4)` | Muted descriptions, subtext | Low | | official | `--color-text-muted` |
| `#ffffff` | Inverse text, white button bg | Medium | | official | `--color-text-inverse` |
| `#eaecb0` | Accent soft eyebrow pill bg | Low | `rgba(234, 236, 176, 0.7)` | official | `--color-accent-soft` |
| `#e2e67f` | Accent strong text, tag markers | Medium | `#d5dc2b` | official | `--color-accent-strong` |
| `#dceccb` | Accent green card background | Low | | official | `--color-accent-surface` |
| `#ede7fd` | Lavender CTA card background | Low | `#e8e1fc` | candidate | `--color-accent-lavender` |
| `#e5e7eb` | Divider lines, subtle card borders | High | | official | `--color-border-subtle` |
| `#22423f` | Dark card icon badge bg | Low | | exception | `--color-bg-icon-dark` |

## Typography table

| Figma style | Usage | Similar styles | Decision | Token |
|---|---|---|---|---|
| `Geist Medium, 64px, leading 1.1, tracking -3.7px` | Hero Heading 1 | 60px | official | `display` |
| `Geist Medium, 60px/56px, leading 1.1, tracking -3px` | Section Heading | 64px | official | `section-title` |
| `Geist Medium, 26px, leading 1.2, tracking -0.5px` | Card/Brief Heading | | official | `card-title` |
| `Geist SemiBold, 11px/13px, uppercase` | Eyebrow label | | official | `eyebrow` |
| `Geist Regular, 20px, leading 1.6, tracking -0.5px` | Hero subtitle / Body large | | official | `body-large` |
| `Geist Regular, 16px, leading 1.5/1.6` | Standard body | 15px | official | `body` |
| `Geist Regular, 14px/13px, leading 1.5` | Small body, metadata, check items | 15px | official | `body-small` |
| `Geist SemiBold, 16px/14px, leading normal` | Buttons / CTA labels | | official | `button` |

## Spacing table

| Value | Usage | Locations | Decision | Token |
|---:|---|---|---|---|
| `100px` | Section top/bottom padding | Hero, Services, FAQ sections | official | `space-24` / `--space-5xl` |
| `80px` | Section gaps, page horizontal padding | Main layouts, Hero bottom padding | official | `space-20` / `--space-4xl` |
| `60px` | Section gaps, padding | Services, CTA section | official | `space-15` / `--space-3xl` |
| `40px` | Card padding, bottom/top grid margins | Accent card, Starter card | official | `space-10` / `--space-2xl` |
| `32px` | Card padding, list spacing | sidebar card, what-localup list | official | `space-8` / `--space-xl` |
| `24px` | Grid padding, layout inner gaps | services grid, pricing cards | official | `space-6` / `--space-lg` |
| `16px` | Gap between elements | Button groups, card lists | official | `space-4` / `--space-md` |
| `12px` | Checklist item gaps, badge gaps | checklist, eyebrow pills | official | `space-3` / `--space-sm` |
| `8px` | Small icon/text gaps | Button inner elements | official | `space-2` / `--space-xs` |

## Radius table

| Value | Usage | Locations | Decision | Token |
|---:|---|---|---|---|
| `32px` | Dominant CTA card / hero panels | final-cta-section | official | `--radius-3xl` |
| `24px` | services-included card, pricing cards | services content grid wrapper | official | `--radius-2xl` |
| `20px` | Hero right panel, FAQ sidebar card | Hero section, FAQ section | official | `--radius-xl` |
| `16px` | feature cards, accent cards | what-localup, services grid | official | `--radius-lg` |
| `12px` | Eyebrow pills, primary buttons, mockups | eyebrow, CTA buttons | official | `--radius-md` |
| `8px` | Button primary, checklist tags | Hero primary button | official | `--radius-sm` |
| `4px` | mockup inner elements | website clarity mockups | official | `--radius-xs` |
| `999px`| Pills / circles / customer avatars | Hero avatar stack | official | `--radius-pill` |

## Shadow/effect table

| Effect | Usage | Locations | Decision | Token |
|---|---|---|---|---|
| `0px 2px 4px rgba(0,0,0,0.06)` | Primary button shadow | Hero primary button | official | `--shadow-small` |
| `0px 4px 8px rgba(0,0,0,0.05)` | Review mockups / card items | feature-card-reviews | official | `--shadow-card` |
| `0px 12px 20px rgba(1,35,31,0.03)`| Hero right panel shadow | Hero section | candidate | `--shadow-panel` |
| `0px 12px 40px rgba(0,0,0,0.03)`| Dominant card/grid shadow | services content grid wrapper | official | `--shadow-hero` |

## Border table

| Border value | Usage | Locations | Decision | Token |
|---|---|---|---|---|
| `1px solid #e5e7eb` | Subtle borders for cards and sections | pricing card starter, services card | official | `--color-border-subtle` |
| `1px solid #01221f` | Strong borders for buttons and items | pricing card button, secondary buttons | official | `--color-border-strong` |
| `1px solid rgba(255,255,255,0.13)`| Dark card internal borders | website clarity mockup, dark cards | candidate | `--color-border-dark-subtle` |

## Final CSS variable output

```css
:root {
  --color-bg-page: #fffffe;
  --color-bg-surface: #fffffe;
  --color-bg-card: #fffffe;
  --color-bg-card-warm: #f7f1e6;
  --color-bg-muted: #f0f2e8;
  --color-bg-dark: #01221f;

  --color-text-primary: #020c0b;
  --color-text-secondary: rgba(2, 12, 11, 0.7);
  --color-text-muted: rgba(2, 12, 11, 0.4);
  --color-text-inverse: #ffffff;

  --color-accent-soft: #eaecb0;
  --color-accent-strong: #e2e67f;
  --color-accent-surface: #dceccb;
  --color-accent-lavender: #ede7fd;

  --color-border-subtle: #e5e7eb;
  --color-border-strong: #01221f;
  --color-border-dark-subtle: rgba(255, 255, 255, 0.13);

  --color-bg-icon-dark: #22423f;

  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --radius-3xl: 32px;
  --radius-pill: 999px;

  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 40px;
  --space-3xl: 60px;
  --space-4xl: 80px;
  --space-5xl: 100px;

  --shadow-small: 0px 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-card: 0px 4px 8px rgba(0, 0, 0, 0.05);
  --shadow-panel: 0px 12px 20px rgba(1, 35, 31, 0.03);
  --shadow-hero: 0px 12px 40px rgba(0, 0, 0, 0.03);
}
```
