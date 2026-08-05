/**
 * `server-only` throws when imported outside a React Server Component, which
 * would make every server module untestable under Vitest. Aliased to this
 * no-op in vitest.config.mts.
 *
 * The guarantee is not weakened: `next build` still enforces the real boundary,
 * so a client component importing a server module fails the build.
 */
export {};
