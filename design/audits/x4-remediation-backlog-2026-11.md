# Accessibility and responsiveness remediation backlog — November 2026

Prioritised fixes for the findings in [`x4-wcag21aa-2026-11.md`](x4-wcag21aa-2026-11.md). Ids in
brackets (C1, K2, R1…) point back to the audit. Items are grouped by **root cause, not by surface**,
so one item often closes findings on many surfaces.

**Priority**

| Priority | Meaning |
|---|---|
| P0 | blocks a keyboard or small-screen user from a core flow, or fails AA on every page |
| P1 | fails AA on a key surface |
| P2 | fails AA in a narrower place, or is a best-practice defect with real user impact |
| P3 | hygiene, advisory, or tooling |

**Size:** S is under a day, M is 1–3 days, L is more than 3 days or crosses repos.

**Mockup:** "yes" for any change that is visible on screen, per the mockup-before-UI-build rule. A
pure semantics or focus change that alters no pixels at rest says "no". A change that alters only the
focus state says "focus state only", and that still needs a design sign-off.

## Summary

| # | Pri | Item | Closes | Size | Mockup |
|---|---|---|---|---|---|
| 1 | P0 | Responsive shell: collapse the sider below `lg`, make the header fit | R1 | L | yes |
| 2 | P0 | Wire antd's secondary and placeholder text tokens to the passing palette tokens | C1, the shared cause of most `color-contrast` entries | S | yes |
| 3 | P0 | Session-expired surface: move focus in, contain it, make the app behind it inert | K1 | M | no |
| 4 | P0 | Collapsed Agentiko rail leaves the tab order; Escape returns focus to the toggle | K2, K3 | S | no |
| 5 | P1 | Primary "wash" button label to an AA colour, and pin the pair that ships | C2 | S | yes |
| 6 | P1 | Agentiko rail at narrow widths: overlay or full screen instead of squeezing | R2 | M | yes |
| 7 | P1 | Create form: mark sections that hold errors, add a summary, focus the first error | K6 | M | yes |
| 8 | P1 | Associate every visible form label with its field | K7, `label` | S | no |
| 9 | P1 | Avatar `alt`, and no `<img>` without a source | `image-alt` | S | no |
| 10 | P1 | Listy and Card semantics: interactive element inside the `<li>`, named progress bars, no nested controls | `list`, `aria-progressbar-name`, `nested-interactive`, `aria-allowed-role` | M | no |
| 11 | P1 | Sortable table headers get the global focus ring | K4 | S | focus state only |
| 12 | P1 | Control borders that meet 3:1 (1.4.11) | C3 | M | yes |
| 13 | P2 | Tag, chip and code colours to AA; remove literal hex from table cells | C4 | M | yes |
| 14 | P2 | Focus management after actions: sign-in failure, route change, approval decision | K5 | M | no |
| 15 | P2 | Keyboard-scrollable code and YAML blocks | `scrollable-region-focusable` | S | focus state only |
| 16 | P2 | Name the remaining unnamed surfaces: command palette dialog, Agentiko composer, landmarks | `aria-dialog-name`, K8, `landmark-unique` | S | no |
| 17 | P2 | Login page structure: `main` landmark and `h1` | `landmark-one-main`, `region`, `page-has-heading-one` | S | no |
| 18 | P2 | Approval card time limit: show the countdown and allow extending it | 2.2.1, needs review | S | yes |
| 19 | P3 | antd Tabs overflow button inside `tablist` at narrow widths | `aria-required-children` | S | no |
| 20 | P3 | Heading levels in list item titles | `heading-order` | S | no |
| 21 | P3 | Targets under 24 × 24 px (WCAG 2.2 readiness) | advisory | M | yes |
| 22 | P3 | Session-expired logo is invisible on the light card | UX | S | yes |
| 23 | P3 | Land the audit harness, add axe to CI, and re-run this audit | process | M | no |

**Top 10 by impact per effort:** 2, 4, 1, 3, 5, 8, 9, 11, 7, 10.

## Items

### 1. P0 — Responsive shell [R1] · L · mockup: yes

- **Problem.** The sider is 236 px wide at every viewport. The content column is 1204 / 532 / 154 /
  84 px at 1440 / 768 / 390 / 320 px. At 390 px the theme toggle, the Agentiko toggle and the account
  menu are clipped out of the header.
- **WCAG.** 1.4.10 Reflow (AA).
- **Where.**
  - `ui/src/widgets/Layout/Layout.tsx`: already forwards `breakpoint`, `collapsible`,
    `collapsedWidth` and `defaultCollapsed` to antd `Sider`.
  - `ui/src/widgets/Layout/Layout.schema.json`.
  - `ui/src/components/Shell/Shell.tsx` (`HeaderChrome`), `Shell.module.css`.
  - The app-shell `Layout` CR in the portal chart, which sets none of the four options.
- **Fix.**
  - Give the shell a responsive default in the frontend, so no chart has to opt in: below `lg`
    (992 px) the sider collapses to an icon rail, and below `md` it becomes an off-canvas drawer
    opened from a header button.
  - The header keeps search, Agentiko and the account menu reachable at 320 px. Lower-priority
    controls (theme, notifications) move into the account menu below `sm`.
  - Add the breakpoint to the T6 baseline as the shell's collapse point.
  - Optionally let the CR override the default.
- **Verify.** Re-measure `main` width at 320 px (target: at least 288 px) and check that no header
  control is clipped.
- **Why the frontend default and not only the CR.** A Layout CR that omits the keys should not
  produce a portal that fails reflow.

### 2. P0 — antd derived text tokens [C1] · S · mockup: yes (text gets darker everywhere)

- **Problem.** `lightTheme` and `darkTheme` set `colorTextBase` but no derived text token, so antd's
  alpha blends render secondary text at 2.95–2.99:1 (light), 4.47–4.48:1 (dark), and placeholders and
  the project select's resting text at 1.74:1 / 2.19:1. This is the largest single cause of the
  `color-contrast` entries on 12 surfaces.
- **WCAG.** 1.4.3 Contrast (AA).
- **Where.** `ui/src/theme/tokens.ts` (`lightTheme.token`, `darkTheme.token`),
  `ui/src/theme/tokens.contrast.test.ts`.
- **Fix.**
  - Set `colorTextSecondary` and `colorTextDescription` to `gray`, and `colorTextTertiary`,
    `colorTextPlaceholder` and `colorTextQuaternary` to `faint`, per mode. These are the tokens T7
    already pins: light `gray` 6.7:1 and `faint` 5.6:1 on white.
  - Extend `tokens.contrast.test.ts` to assert each antd text token the theme emits against
    `background`, `panelbg` and `lightgray`, so a future token addition cannot reintroduce an alpha
    blend.
- **Note.** The header project select shows "All projects" as placeholder text, but it is the
  control's value. Either render it as the selected value or accept the placeholder colour change
  above.

### 3. P0 — Session-expired surface focus [K1] · M · mockup: no

- **Problem.** The full-viewport `div role="dialog" aria-modal="true"` takes no focus on open. Tab
  then walks the hidden app behind it: 14 of 14 stops were outside the dialog.
- **WCAG.** 2.4.3 Focus Order, 2.4.7 Focus Visible.
- **Where.** `ui/src/components/SessionResume/SessionResumeModal.tsx`.
- **Fix.**
  - On open, focus the heading (`tabIndex={-1}`) or the first credential field.
  - Make the rest of the app `inert`: the shell root, the rail and the drawers.
  - Restore focus to the previously focused element after a successful resume.
  - Label the dialog by its heading (`aria-labelledby`) rather than the fixed `aria-label`, so it
    follows the cause-specific title.
  - Add a test that tabs N times and asserts focus never leaves the dialog. The same harness as
    `focusTrap.ts` can serve.

### 4. P0 — Collapsed rail out of the tab order; Escape restores focus [K2, K3] · S · mockup: no

- **Problem.**
  - When collapsed, the rail's `aside` is 0 px wide but neither `inert` nor `aria-hidden`, so its 10
    controls stay in the tab order on every page.
  - Escape collapses the rail and leaves focus in the now-hidden composer, at x = 1466 on a 1440 px
    viewport.
- **WCAG.** 2.4.3, 2.4.7.
- **Where.** `ui/src/components/Agentiko/AgentikoRail.tsx`, `focusTrap.ts`.
- **Fix.**
  - Set `inert` on the rail container whenever it is collapsed.
  - In the collapse path shared by Escape and the button, move focus to the Agentiko toggle, then
    collapse.
  - Extend C4's tests: collapsed means zero focusable descendants, and Escape means the toggle is
    focused.

### 5. P1 — Primary wash button label [C2] · S · mockup: yes

- **Problem.** The 14 % wash puts the `--primary-color` label at 4.18:1 at rest, 3.93:1 on the page
  ground and 3.62:1 on hover or focus, in light mode. T7 pins primary on white, a pair that is never
  drawn.
- **WCAG.** 1.4.3.
- **Where.** `ui/index.css`, the primary-wash rules; `ui/src/theme/tokens.contrast.test.ts`.
- **Fix.**
  - Use the brand's `accentActive` (`#7200B8`) as the wash label colour in light mode. It measures
    6.78:1 on the resting wash, 5.86:1 on the hover wash and 6.38:1 on the page-ground wash.
  - Keep the border and fill as they are. Dark mode already passes.
  - Change the T7 test to compute the label against the composited wash colour, the pair that ships.

### 6. P1 — Agentiko rail at narrow widths [R2] · M · mockup: yes

- **Problem.** At 768 px the open rail leaves the page 148 px. At 390 px it leaves 64 px and covers
  the nav and the header controls.
- **WCAG.** 1.4.10.
- **Where.** `ui/src/components/Agentiko/AgentikoRail.module.css` (existing 1024 and 640 px
  breakpoints), `AgentikoRail.tsx`.
- **Fix.**
  - Below `lg` the rail overlays the page as a modal sheet, with the C4 trap active and the page
    `inert`.
  - Below `sm` it is full-screen with a visible close control.
  - Keep "docked, not an overlay" for desktop only.
  - Depends on item 1 for the shared breakpoint.

### 7. P1 — Create form error identification [K6] · M · mockup: yes

- **Problem.** Submitting the blueprint create form shows "name is required" in a section the user
  cannot see. The section navigation carries no marker, there is no summary, and focus stays on the
  submit button.
- **WCAG.** 3.3.1 Error Identification, 3.3.3 Error Suggestion.
- **Where.** The `Form` widget's sectioned layout, the "Top-level values / app / database"
  navigation (`ui/src/widgets/Form/`).
- **Fix.**
  - On a failed submit, mark each section that holds an error, with a count in text and an icon,
    not colour alone.
  - Render an error summary at the top of the form as a list of links to each field.
  - Move focus to the summary or the first invalid field, switching sections if needed.

### 8. P1 — Associate visible labels [K7, `label`] · S · mockup: no

- **Problem.**
  - 12 `Form.Item label=…` have neither `name` nor `htmlFor`, in `StartDraftModal`, `BindDataModal`,
    `DataBindingModal` and `StartControllerModal`. The fields are named by their placeholders. axe
    passes them, because a placeholder counts as a name.
  - The `Select` widget never names its combobox. On access detail that leaves the namespace picker
    with no name at all, axe `label`, critical.
- **WCAG.** 1.3.1, 2.5.3 Label in Name, 3.3.2, 4.1.2.
- **Where.** The four modals under `ui/src/pages/PageBuilder/` and
  `ui/src/pages/ControllerBuilder/`, and `ui/src/widgets/Select/Select.tsx`.
- **Fix.**
  - Give each `Form.Item` a `name`, or an `htmlFor` paired with the child's `id`.
  - In `Select`, set `aria-label` from `label ?? placeholder ?? name`.
  - Add a source check beside `a11yTriggers.test.ts`: a `Form.Item` with `label` must have `name` or
    `htmlFor`.

### 9. P1 — Avatar alternative text [`image-alt`] · S · mockup: no

- **Problem.** The sider footer and account-menu avatars render `<img>` with no `alt`, and with
  `src=""` when the identity has no avatar URL. This happens on every signed-in page.
- **WCAG.** 1.1.1.
- **Where.** `ui/src/components/Shell/Shell.tsx` (`SiderFooter`),
  `ui/src/components/UserMenu/UserMenu.tsx`.
- **Fix.**
  - Pass `src` only when the URL is non-empty, so the initial letter renders instead.
  - Pass `alt=""` because the name is printed beside it. In the account trigger the button's own
    label carries the name.

### 10. P1 — Listy and Card semantics [`list`, `aria-progressbar-name`, `nested-interactive`, `aria-allowed-role`] · M · mockup: no

- **Problem.**
  - `ListView` puts `role="button"` on the `<li>`, which breaks the list (1.3.1).
  - Its progress bars have no name (1.1.1).
  - A clickable `Card` contains focusable content: the dashboard card wraps a list, and the
    blueprint tiles wrap a "Create" button (4.1.2).
- **Where.** `ui/src/widgets/List/ListView.tsx`, `ui/src/widgets/Card/Card.tsx`, and their
  `*.a11y.test.tsx`.
- **Fix.**
  - Keep `<li>` semantic and put the interactive role on a full-row `<button>` or `<a>` inside it.
    That keeps C8's keyboard contract.
  - Give `Progress` an `aria-label` built from the row's primary text and the metric.
  - For tiles with their own actions, make the title the link and give the card a stretched-link
    pointer area, so there is no `role="button"` wrapper around other controls.
  - Extend the existing a11y tests with an axe pass. axe-core is already installed.

### 11. P1 — Sortable header focus [K4] · S · mockup: focus state only

- **Problem.** antd sets `outline: none` on sortable `th`. Focus shows only as a header-text
  recolour, about 1.2:1 between states. There are 7 such tab stops on Compositions.
- **WCAG.** 2.4.7, 1.4.1.
- **Where.** `ui/src/widgets/Table/` styles, or `ui/index.css` next to the global ring.
- **Fix.** Restore the C3 ring for
  `.ant-table-thead th.ant-table-column-has-sorters:focus-visible`, with an inset offset so the cell
  does not clip it.

### 12. P1 — Control borders at 3:1 [C3] · M · mockup: yes

- **Problem.** Input and select borders are `colorBorder` `#E5E2F0`: 1.28:1 on a white panel and
  1.19:1 on the page. Dark is `#3A3148` at 1.55:1. An empty field's boundary is not perceivable.
- **WCAG.** 1.4.11 Non-text Contrast.
- **Where.** `ui/src/theme/tokens.ts` (`color.border`, `colorDark.border`, `colorBorderSecondary`)
  and the antd component overrides in `buildComponents`.
- **Fix.**
  - Introduce a control-border token at 3:1 or more per mode and apply it to `Input`, `Select`,
    `InputNumber`, `DatePicker` and `Checkbox` via component tokens.
  - Keep the hairline `border`/`line` for cards and dividers, which are decorative.
  - Pin both pairs in T7.

### 13. P2 — Tag, chip and code colours [C4] · M · mockup: yes

- **Problem.**
  - The blue status tag is 2.14:1.
  - Filter-chip counts are 2.60:1 light and 3.09:1 dark.
  - The dark Drift tag is 3.48:1.
  - Green and gold filled tags on tinted cards are 3.0–3.6:1, and the red tag is 4.41:1.
  - Rail inline code and context text (`--cyan-color`) are 3.74:1.
  - The YAML syntax theme is 3.28:1.
  - The settings audit-log cells carry literal `#FF0000`, `#008000` and `#8C8C8C`.
- **WCAG.** 1.4.3.
- **Where.**
  - The tag presets in `ui/src/theme/tokens.ts` (dark ramps already seeded, light is antd's own).
  - `ui/src/widgets/Select/Select.module.css` and the chip count styles in `ListView`.
  - `ui/src/components/Agentiko/AgentikoRail.module.css` (`.apCtx b`, `.apMsgBot code`).
  - The syntax-highlighter style in `YamlBlock` / `YamlViewer`.
  - The settings chart's `audit-log` table template (portal chart).
- **Fix.**
  - Extend T7's tag-ink test, which today covers dark only, to light, and to tags on tinted card
    grounds.
  - Swap rail `cyan` text to `green` or `info`.
  - Pick or adjust a syntax theme whose token colours clear 4.5:1 on both grounds.
  - Replace the literal hex in the chart with the semantic tag `color` the Table cell already
    supports.

### 14. P2 — Focus after actions [K5] · M · mockup: no

- **Problem.** Focus falls to `<body>` after a failed sign-in, after SPA navigation from a row or
  card, and after an approval decision unmounts its card.
- **WCAG.** 2.4.3.
- **Where.**
  - `ui/src/pages/Login/Login.tsx` and `AuthMethods`.
  - `ui/src/components/WidgetPage/WidgetPage.tsx`, the route-change hook.
  - The approval card in `ui/src/components/Agentiko/`.
- **Fix.**
  - On sign-in failure, return focus to the first credential field. The error is already a
    `role="alert"`.
  - On route change, focus the page `h1` (`tabIndex={-1}`) once it renders.
  - After a decision, focus the result message or the composer.

### 15. P2 — Keyboard-scrollable code blocks [`scrollable-region-focusable`] · S · mockup: focus state only

- **Problem.** At narrow widths the YAML and code blocks scroll horizontally but cannot take focus.
  This covers the composition manifest and 10 page-builder file previews.
- **WCAG.** 2.1.1.
- **Where.** `ui/src/components/YamlBlock/`, `ui/src/widgets/YamlViewer/`, and the page builder's
  file preview.
- **Fix.** Give the scroll container `tabIndex={0}`, `role="region"` and an `aria-label` of the file
  name.

### 16. P2 — Name the unnamed [`aria-dialog-name`, K8, `landmark-unique`] · S · mockup: no

- **Command palette.** The antd `Modal` has no `title`. Add `aria-label="Search"`
  (`ui/src/components/CommandPalette/CommandPalette.tsx`).
- **Agentiko composer.** Add `aria-label="Message Agentiko"`, keeping the placeholder
  (`AgentikoRail.tsx`).
- **Landmarks.** Label the sider `aside` "Primary" (in `Layout.tsx`) and the rail `aside`
  "Agentiko".
- **WCAG.** 4.1.2 and 3.3.2; `landmark-unique` is best practice.

### 17. P2 — Login structure [`landmark-one-main`, `region`, `page-has-heading-one`] · S · mockup: no

- **Problem.** The login page has no `main`, and "Welcome back" is an `h2` with no `h1`.
- **WCAG.** Best practice. It supports 1.3.1 and 2.4.6.
- **Where.** `ui/src/pages/Login/Login.tsx`.
- **Fix.** Wrap the form column in `<main>`. Make the visible "Welcome back" the `h1`, and keep the
  brand headline as a styled paragraph or `h2`.

### 18. P2 — Approval time limit [2.2.1, needs review] · S · mockup: yes

- **Problem.** "Waiting 5 minutes denies" is a time limit the user cannot see or extend.
- **WCAG.** 2.2.1 Timing Adjustable.
- **Where.** The approval card, under `ui/src/components/Agentiko/`.
- **Fix.**
  - Show the remaining time.
  - About 30 s before expiry, announce it through the existing live region and offer "More time".
  - If the limit must stay fixed for security, record that as the essential exception in
    `design/05-agent-parity.md` and say so on the card.

### 19. P3 — antd Tabs overflow button [`aria-required-children`] · S · mockup: no

- **Problem.** At narrow widths antd moves overflowing tabs into a "more" button inside
  `role="tablist"`. This affects Observability and the page builder's Files/Source tabs.
- **WCAG.** 1.3.1.
- **Fix.** Check the antd version for a fix, otherwise file it upstream. Item 1 removes most of the
  narrow-width cases.

### 20. P3 — List title heading levels [`heading-order`] · S · mockup: no

- **Problem.** antd `List.Item.Meta` titles render as `h4` directly under the page `h1`.
- **Where.** `ListView.tsx`.
- **Fix.** Render the title as styled text, not a heading, unless the list sits under a card heading
  of the right level.

### 21. P3 — Targets under 24 × 24 px [advisory, WCAG 2.2 SC 2.5.8] · M · mockup: yes

- **Problem.** Small targets include the password "Show" toggle (14 × 14), filter chips (21 px
  tall), compact inputs (22 px), and rail header icons. Per surface there are 4 (login) to 27 (page
  builder canvas) at 1440 px.
- **Fix.** Not a 2.1 AA requirement. Fold it into item 1's density review, so the narrow layout does
  not inherit 14 px targets.

### 22. P3 — Session-expired logo [UX] · S · mockup: yes

- **Problem.** The surface renders the sider's light logo mark on a white card, which reads as blank
  space.
- **Where.** `SessionResumeModal.tsx`.
- **Fix.** Use the mode-appropriate mark, the one the login brand panel uses, or put the mark on the
  brand ground.

### 23. P3 — Land the harness, gate axe, re-audit [process] · M · mockup: no

- **Problem.** This audit ran from a scratch harness. Without it, closing items 1–22 cannot be
  verified the same way, and Lighthouse did not run (audit §7).
- **Fix.**
  - Land the harness in `ui/audit/`, with its own Playwright config that the visual job's
    `*.spec.ts` match does not pick up. The harness is: a mock snowplow/authn/agent that serves
    chart-rendered widget CRs through their own jq templates; the scenario runner; the keyboard
    pass; and the layout probe.
  - Run axe over the 17 scenarios in CI, starting from this audit's baseline as a ratchet: a new
    rule × surface fails, a fixed one must be removed from the baseline.
  - Resolve the Lighthouse load hang or run it against a deployed portal.
  - Re-run this audit when items 1–12 land.
