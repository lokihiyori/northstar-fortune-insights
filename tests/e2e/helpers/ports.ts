/**
 * Ports the end-to-end suite binds, in one place so the Playwright config and
 * the specs cannot disagree.
 *
 * The main server runs with demo mode **on**, because the enabled journey is
 * most of the suite. Demo status is read from the server's environment on every
 * request, so proving the disabled behaviour needs a genuinely separate process
 * — that is the point of the second port.
 */
export const DEMO_DISABLED_PORT = 4399;
export const DEMO_DISABLED_ORIGIN = `http://127.0.0.1:${String(DEMO_DISABLED_PORT)}`;
