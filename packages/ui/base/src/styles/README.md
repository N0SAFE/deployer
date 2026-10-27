# @deployer/ui design tokens

Source of truth: `globals.css` (`:root` = light, `.dark` = dark). Every colour is an
`oklch()` token exposed to Tailwind through `@theme inline`. Contrast is enforced:
`bun scripts/contrast.ts` prints the audit; `__tests__/styles/contrast.test.ts` fails
if a pair drops below its threshold (text 4.5:1, body 7:1, UI boundary / focus 3:1).

## Surfaces and text
| Token | Use |
|---|---|
| `background` / `card` / `popover` | page, raised surface, overlay. Cards must read as distinct from the page in both themes |
| `foreground` | body text (>= 7:1) |
| `muted-foreground` | secondary text. >= 4.5:1 on background, card and `muted`. Do NOT dim it further with `/60` or `opacity-*` |
| `border` | decorative dividers and card edges (intentionally quiet) |
| `control-border` | boundary of interactive controls (input, select, textarea, checkbox). >= 3:1 |
| `ring` | focus ring, >= 3:1. Never remove focus-visible styling |

## Status colours
Five roles, each with fg / bg / border, in both themes:

`text-success bg-success-bg border-success-border` (also `warning`, `danger`, `info`, `neutral`).
They derive from `--status-live | pending | danger | busy | idle`. Rules:
- Use `<Badge variant="success-subtle|warning-subtle|danger-subtle|info-subtle|neutral">`; do not hand-roll
  `bg-green-500/10 text-green-400`.
- Status is colour AND text (and ideally an icon). Never colour alone.
- `text-status-*` tokens are safe as text on `background`/`card` (>= 4.5:1).

## Type scale
Utilities (CSS variables `--text-*`): `text-page-title` 24, `text-section-title` 18, `text-body` 14,
`text-small` 13, `text-label` 12, `text-mono` 13 (font-mono). Minimum rendered size is 12 px: no
`text-[10px]` / `text-[0.625rem]`. Numbers in tables: `tabular-nums` and `data-numeric` on `TableCell`
(right-aligns).

## Spacing and density
4 px base, 8 px rhythm (Tailwind `--spacing`). Controls: Button/Input/Select default 32 px, sm 28, xs 24, lg 36.
Table: head 36 px, row 40 px. Dialog: bottom sheet under `sm`, scrolls within `100dvh`.

## Components added or extended (all backward compatible)
- `Button`: `loading` prop (spinner, `aria-busy`, disabled).
- `Spinner` (`shadcn/spinner`): `role="status"` with sr-only `label`.
- `Badge`: `success-subtle | warning-subtle | danger-subtle | info-subtle | neutral`.
- `Skeleton`: `variant="text|row|card|circle"`.
- `Table`: `stickyHeader`, `containerClassName`; `TableCell[data-numeric]`.
- `Tabs`: list scrolls horizontally when narrow. `Tooltip` default delay 300 ms.

## Motion
`prefers-reduced-motion: reduce` zeroes transitions, stops pulse/bounce/ping and entrance animations,
and slows `animate-spin` (kept, it signals progress).

## Do / Don't
- Do use tokens (`text-muted-foreground`, `border-control-border`); don't use raw palette colours.
- Do give icon-only buttons an `aria-label`; don't convey state by colour alone.
- Don't add new sub-12 px text or lower-contrast opacity variants of muted text.
