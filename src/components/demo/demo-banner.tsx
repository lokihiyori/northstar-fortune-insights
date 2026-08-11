/**
 * Persistent demo label shown on every authenticated page of the demo account.
 *
 * Accessibility decisions, all deliberate:
 *
 *  - `role="note"` with an `aria-label`, not `role="alert"`. It is standing
 *    context, not an event; an alert would interrupt a screen reader on every
 *    navigation.
 *  - Carries a text label and an icon, so the meaning does not depend on the
 *    warning colour (WCAG 1.4.1).
 *  - Uses `--ns-warning` and `text-text-primary` on a tinted surface, both of
 *    which cleared AA in the Phase 8F contrast pass in light *and* dark themes.
 *    Nothing here is dimmed with `opacity`.
 *  - Static text with no controls, so there is nothing to trap focus; the skip
 *    link still lands on `<main>` below it.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demo workspace notice"
      className="border-warning/40 bg-warning/10 text-text-primary border-b px-5 py-2.5 sm:px-8"
    >
      <p className="mx-auto flex max-w-5xl items-start gap-2 text-sm">
        <span aria-hidden="true" className="text-warning font-semibold">
          ●
        </span>
        <span>
          <strong className="font-semibold">Demo workspace — fictional data.</strong> Changes are
          temporary and are reset periodically. Do not enter personal information.
        </span>
      </p>
    </div>
  );
}

/** Compact marker for the app header, next to the account name. */
export function DemoBadge() {
  return (
    <span className="border-warning/50 text-text-primary rounded-control border px-2 py-0.5 text-xs font-medium">
      Demo
    </span>
  );
}
