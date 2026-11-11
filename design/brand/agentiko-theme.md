# Agentiko theme

The portal's palette and type, written out. The values live in `ui/src/theme/tokens.ts`
(`color`, `colorDark`, `agentikoBrand`); the rules that pin them are T5, T7 and T11 in
[`../01-tokens.md`](../01-tokens.md). If this page and the code disagree, the code and its
contrast tests win. Fix this page.

## Brand colours

| Name | Hex | Use |
|---|---|---|
| Violet | `#9E00FF` | primary in light mode; start of the gradient |
| Blue | `#2213CF` | `blue` in light mode; end of the gradient |
| Black | `#000000` | sidebar |
| Lilac | `#DCD8F1` | the logo on the black sidebar |

No colour outside this table, the neutrals below and the status colours is part of the brand.

## Light and dark

The brand violet and blue are too dark to read as text on the dark ground (3.6:1 and 1.9:1), so
dark mode uses a lighter tint of each.

| Role | Light | Dark |
|---|---|---|
| Primary (text, links, outlines, focus ring) | `#9E00FF` | `#C27AFF` |
| `blue` (tags, cells, stats) | `#2213CF` | `#9C8FFF` |
| Canvas | `#F7F6FB` | `#07050C` |
| Surface | `#FFFFFF` | `#120E1A` |
| Sidebar | `#141414` | `#000000` |
| Sidebar selected item | `#9E00FF` with a white label | `#9E00FF` with a white label |
| Primary button label (on the violet wash) | `#7200B8` | `#CB8EFF` |

Status colours (success, warning, error, info) and Signal Yellow are not part of the brand and do
not change. Signal Yellow means only that Agentiko is executing.

## Gradient

**Violet → blue, left to right.**

- **Fill** (the agent's buttons and the login panel): `#9E00FF` → `#2213CF` in both modes, always
  with a **white** label. Never dark text on violet, blue or the gradient.
- **Mark** (the rail band, the monogram, gradient text) follows the mode:
  `#9E00FF` → `#2213CF` on light, `#C27AFF` → `#9C8FFF` on dark.

The agent's controls are the only filled controls in the portal. Every other primary action is the
violet wash.

## Type

| Role | Face |
|---|---|
| Headings, body, labels | Syne |
| Data: identifiers, versions, numbers, YAML, logs | JetBrains Mono, tabular figures |

Syne is never used for data: its "1" and "0" read as "ı" and "o".

## Logo and monogram

- The sidebar shows the Krateo PlatformOps logo in lilac `#DCD8F1`, with no filter or opacity.
- The Agentiko monogram (`AgentikoMark`) is drawn in `currentColor` or in the gradient.
- Do not recolour either mark outside the palette, rotate it, distort it, outline it or add
  effects.
- On violet, blue, the gradient or black the mark is white.
