# Accessibility audit

Phase 8F. Closes the gap where "Lighthouse accessibility ≥95" had been claimed but never measured.

> **What this proves.** Lighthouse **100/100** accessibility on all four gate routes, and zero
> critical or serious axe violations across 19 automated checks covering both themes.
>
> **What it does not prove.** This is an automated audit of a local build. Automated tooling catches
> roughly a third to a half of real accessibility problems; it cannot judge whether a label is
> _meaningful_, whether reading order makes sense, or how the product behaves with an actual screen
> reader. **No WCAG conformance claim is made, and none should be.** No testing with assistive
> technology or with disabled users has taken place.

## Tooling

| Tool                   | Version                   | Used for                          |
| ---------------------- | ------------------------- | --------------------------------- |
| Lighthouse             | **12.8.2**                | The four gate routes, 3 runs each |
| `@axe-core/playwright` | **4.12.1** (pinned exact) | 19 automated checks, both themes  |
| Chromium               | Playwright build 1234     | Both                              |
| Node.js                | 22.16.0                   |                                   |

Lighthouse configuration: default mobile form factor, `simulate` throttling, 3 runs per route, no
custom config or category weighting. Lighthouse is **not** a repository dependency — it was installed
into a temporary directory outside the working tree so it cannot drift into the lockfile.

axe runs with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Best-practice rules are reported but
not treated as a gate. **No rule is disabled and no selector is excluded.**

## Final Lighthouse results

Accessibility is the gate; performance is recorded in
[performance.md](performance.md) and has no pass/fail threshold.

| Route      | Mode               | Requested                       | Final URL | Redirect? | Status | Accessibility (3 runs) | Median  |
| ---------- | ------------------ | ------------------------------- | --------- | --------- | ------ | ---------------------- | ------- |
| `/`        | production build   | `http://127.0.0.1:4100/`        | same      | no        | 200    | 100, 100, 100          | **100** |
| `/pricing` | production build   | `http://127.0.0.1:4100/pricing` | same      | no        | 200    | 100, 100, 100          | **100** |
| `/app`     | development server | `http://localhost:4200/app`     | same      | no        | 200    | 100, 100, 100          | **100** |
| `/admin`   | development server | `http://localhost:4200/admin`   | same      | no        | 200    | 100, 100, 100          | **100** |

Every score is ≥95 and none is rounded up — all four are exactly 100.

### Proof the authenticated routes were not redirects

Both authenticated routes are gated before a score is accepted. The audit script refuses to report
a number unless, for each route:

1. the final pathname equals the requested pathname (any redirect, including to `/sign-in`, aborts);
2. a route-specific authenticated element is present — the `Application` navigation landmark on
   `/app`, the `Operations` heading on `/admin`.

Recorded output:

```
precheck /app:   final=http://localhost:4200/app   redirected=false  marker=true
precheck /admin: final=http://localhost:4200/admin redirected=false  marker=true
```

Lighthouse's own `finalUrl` confirms it independently: every run reports `.../app` and `.../admin`.

**An earlier run was rejected by this gate.** With a freshly created account, `/app` redirects to
`/app/onboarding`, and the first attempt measured that page instead. Those numbers were discarded and
the disposable user now completes onboarding before measurement, so `/app` is the dashboard itself.

### Authenticated-audit limitation

`/app` and `/admin` were audited against the **development server**, not the production build. This
is forced by the security posture, not convenience:

- `next start` sets `NODE_ENV=production`, so Phase 8A startup validation demands an https,
  non-localhost app URL and the process exits before serving.
- Given a fake https URL, the server boots but authentication is dead over http: production forces
  `Secure` and the `__Secure-` cookie prefix (ADR 0007), which a browser refuses on a plain-http
  origin, and Auth.js rejects the mismatched host.

Cookie behaviour was **not** weakened to make Lighthouse authenticate. Accessibility scores are
largely mode-independent — the DOM, names, roles and contrast are the same — but the _performance_
numbers for these two routes are not comparable to production and are labelled accordingly.

## Baseline versus final

Every finding below was discovered by the audit, not assumed.

| #   | Finding                                         | Rule             | Impact  | Where                                          | Baseline       | Final                 |
| --- | ----------------------------------------------- | ---------------- | ------- | ---------------------------------------------- | -------------- | --------------------- |
| 1   | Teal text below AA                              | `color-contrast` | serious | `/`, `/pricing`, `/how-it-works`, `/resources` | 3.88:1         | **5.31:1**            |
| 2   | White on teal button below AA in **dark** theme | `color-contrast` | serious | app shell                                      | 1.84:1         | **10.30:1**           |
| 3   | Gold "Admin" badge                              | `color-contrast` | serious | `/admin`                                       | **2.08:1**     | **4.65:1**            |
| 4   | Success / warning text below AA                 | `color-contrast` | serious | admin forms, legal pages                       | 4.27 / 3.43:1  | 4.61 / 4.66:1         |
| 5   | Badge chips below AA on their own tint          | `color-contrast` | serious | landing, pricing, report                       | 4.04–4.39:1    | ≥4.60:1               |
| 6   | Composer step list dimmed with `opacity-60`     | `color-contrast` | serious | `/app/ask`                                     | ~3:1 effective | readable              |
| 7   | Skip link did not move focus                    | keyboard         | —       | every layout                                   | scroll only    | focus moves to `main` |

Finding 3 was the worst and the last found: the gold token had not been in my first sweep, and axe
caught it on `/admin` after the other five were fixed.

## Fixes

Seven small changes. No component was rewritten and no layout redesigned.

| File                                              | Change                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `src/app/globals.css`                             | Darkened five light-theme tokens; added the `--ns-on-brand` pair |
| `src/components/ui/button.tsx`                    | `text-white` → `text-on-brand` on the primary variant            |
| `src/components/guidance/generation-progress.tsx` | `text-white` → `text-on-brand`; removed `opacity-60`             |
| `src/components/composer/question-composer.tsx`   | `opacity-60` → `border-dashed` for upcoming steps                |
| `src/app/(marketing)/layout.tsx`                  | `main` made focusable                                            |
| `src/app/app/layout.tsx`                          | `main` made focusable                                            |
| `src/app/admin/layout.tsx`                        | `main` made focusable                                            |
| `src/app/(auth)/layout.tsx`                       | `main` made focusable                                            |

### Token changes

Each light-theme value was solved against the **worst** case it appears in — coloured text on a 10%
tint of itself over the page background, which is the Badge chip — rather than the easiest.

| Token                     | Before    | After                            | Worst-case ratio after                               |
| ------------------------- | --------- | -------------------------------- | ---------------------------------------------------- |
| `--ns-brand-teal` (light) | `#1a8b87` | `#167370`                        | 4.64:1 on tint, 5.31:1 as text, 5.64:1 white-on-teal |
| `--ns-brand-gold` (light) | `#d9a441` | `#826227`                        | 4.65:1 on tint                                       |
| `--ns-success` (light)    | `#2f855a` | `#29754f`                        | 4.61:1 on tint                                       |
| `--ns-warning` (light)    | `#b7791f` | `#8d5d18`                        | 4.66:1 on tint                                       |
| `--ns-danger` (light)     | `#c2414b` | `#b53d46`                        | 4.60:1 on tint                                       |
| `--ns-on-brand`           | _(new)_   | `#ffffff` light / `#07111f` dark | 5.64:1 / 10.30:1                                     |

`--ns-on-brand` exists because the two themes fail in opposite directions: the light teal is dark
enough for white text, the dark teal is not. Pairing the foreground with the background as a token
means the two cannot drift apart.

**Dark-theme tokens were not changed.** They already cleared AA everywhere; only the button
foreground needed the paired token.

### Why `opacity` was removed rather than adjusted

`opacity-60` on `text-text-secondary` multiplies an otherwise-passing 5.11:1 down to roughly 3:1.
Upcoming composer steps now use a dashed border and pending pipeline stages rely on font weight, so
the "not yet reached" distinction survives without dimming the label below AA.

Two `opacity-40` usages were **kept** and are correct: disabled criteria chips (WCAG 1.4.3 exempts
inactive controls, and `disabled` plus `cursor-not-allowed` prevents them reading as interactive)
and the `aria-hidden` fit-indicator dots (decorative; the text "Strong fit" carries the meaning).

## axe results by severity and theme

19 tests, both themes on every audited surface.

| Surface                                                                | Light                 | Dark                  |
| ---------------------------------------------------------------------- | --------------------- | --------------------- |
| `/`, `/pricing`, `/how-it-works`, `/resources`, `/sign-in`, `/sign-up` | 0 critical, 0 serious | 0 critical, 0 serious |
| `/app/onboarding` (steps 1 and 2)                                      | 0 / 0                 | 0 / 0                 |
| `/app`                                                                 | 0 / 0                 | 0 / 0                 |
| `/app/history`                                                         | 0 / 0                 | 0 / 0                 |
| `/app/ask` (topic, question, criteria steps)                           | 0 / 0                 | 0 / 0                 |
| `/app/insights/[id]` (report with path tabs)                           | 0 / 0                 | 0 / 0                 |
| `/app/plans/[id]` (task controls)                                      | 0 / 0                 | 0 / 0                 |
| `/admin`, `/admin/sources`, `/admin/sources/new`                       | 0 / 0                 | 0 / 0                 |

**Total: 0 critical, 0 serious.** Coverage includes landmarks, heading hierarchy, document title,
accessible names, form labels, validation errors, buttons versus links, image alternatives, ARIA
validity, tab roles and selected state, table headers, status regions, disabled controls, duplicate
ids, colour contrast, and focusable hidden content.

**No exceptions are recorded, because none were needed.** Nothing is excluded by selector or rule. If
an exception ever becomes necessary it belongs here — with the exact rule, element, reason, owner and
review date — not in a disable list inside the test.

## Keyboard and focus matrix

All rows are automated Playwright assertions in `tests/e2e/accessibility.spec.ts`. Nothing below was
checked only by hand.

| Behaviour                                                    | Surface                 | Result                 |
| ------------------------------------------------------------ | ----------------------- | ---------------------- |
| Skip link is the first Tab stop                              | landing                 | **pass**               |
| Skip link moves focus into `main`                            | landing                 | **pass** (was failing) |
| Focus indicator visible                                      | landing, light          | **pass**               |
| Focus indicator visible                                      | landing, dark           | **pass**               |
| Tab reaches primary navigation                               | marketing header        | **pass**               |
| Enter activates a navigation link                            | marketing header        | **pass**               |
| Theme switch focusable, Enter-operable, keeps focus and name | marketing header        | **pass**               |
| No keyboard trap over 40 Tab presses                         | landing                 | **pass**               |
| Validation error announced via `role="alert"`                | sign-in                 | **pass**               |
| Submit remains operable after a failed attempt               | sign-in                 | **pass**               |
| Focus reachable after error                                  | sign-in                 | **pass**               |
| Sidebar link focusable and Enter-operable                    | `/app`                  | **pass**               |
| Focus not lost after client navigation                       | `/app` → `/app/history` | **pass**               |
| Tablist exposes exactly one selected tab and one panel       | report                  | **pass**               |
| Arrow Right / Left move between tabs                         | report                  | **pass**               |
| Space activates a task button                                | action plan             | **pass**               |
| Progress indicator has an accessible name                    | action plan             | **pass**               |
| Onboarding steps advance from the keyboard                   | onboarding              | **pass**               |
| Admin table and form reachable                               | `/admin/sources`        | **pass**               |

Not covered by automation, and therefore **not claimed**: Escape-to-dismiss and focus-return-to-
trigger for modal dialogs — the product currently has no modal dialog or popover, so there was
nothing to test. If one is added, those rows must be added with it.

## Contrast evidence

Computed directly from the tokens with the WCAG 2.1 relative-luminance formula, and independently
confirmed by axe against the rendered pages.

| Pair                                | Light     | Dark      | Minimum |
| ----------------------------------- | --------- | --------- | ------- |
| `text-primary` on `background`      | 15.44     | 17.73     | 4.5     |
| `text-secondary` on `background`    | 5.11      | 9.27      | 4.5     |
| `brand-teal` on `background`        | **5.31**  | 10.30     | 4.5     |
| `brand-teal` on `surface`           | 5.64      | 9.61      | 4.5     |
| `success` on `background`           | **5.27**  | 10.20     | 4.5     |
| `warning` on `background`           | **5.32**  | 11.67     | 4.5     |
| `danger` on `background`            | **5.31**  | 8.22      | 4.5     |
| `on-brand` on `brand-teal` (button) | **5.64**  | **10.30** | 4.5     |
| Badge text on its own 10% tint      | **≥4.60** | ≥6.62     | 4.5     |
| Focus ring on `surface`             | 5.64      | 9.61      | 3.0     |

Large text (≥18.66px bold or ≥24px) needs only 3:1 and is covered with margin by every value above.

**A note on borders.** A strict 3:1 check across every `--ns-border` pairing fails (1.22:1 light,
1.58:1 dark). That check is stricter than WCAG requires: 1.4.11 applies to visual information needed
to _identify_ a component or its state, not to decorative separators. axe — which implements the
rule properly — reports no violation, and form inputs are identified by their label and focus ring
rather than by border contrast alone. The stricter reading is recorded here as a possible future
refinement, not as an outstanding failure.

## Remaining issues and limitations

1. **Automated coverage only.** No screen reader (NVDA, JAWS, VoiceOver) and no testing with
   disabled users. Automated tools miss the majority of real barriers.
2. **No WCAG conformance claim.** Zero axe violations is not conformance.
3. **`/app` and `/admin` audited in development mode** — see above.
4. **Reduced motion is implemented but not asserted.** `globals.css` honours
   `prefers-reduced-motion`; no test proves it.
5. **No zoom or reflow testing** (WCAG 1.4.10, 200% zoom).
6. **Single viewport.** Lighthouse mobile emulation only; no real device or narrow-viewport keyboard
   pass.
7. **No dialog or popover exists yet**, so dialog focus behaviour is untested by construction.
8. **Border contrast** under the stricter reading of 1.4.11, as described above.

## Reproducing

```bash
pnpm test:e2e -- tests/e2e/accessibility.spec.ts   # 19 axe + keyboard checks
```

Lighthouse is not wired into the test suite: it needs its own Chrome instance and a built server, and
running it on every e2e pass would slow the suite for a number that changes only when the UI does.
The procedure is recorded in [performance.md](performance.md).
