/**
 * The shared instrumentation entry, and deliberately nothing more.
 *
 * Next calls `register()` once per server instance, in **every** runtime, and it
 * must complete before that instance accepts requests. That makes it the only
 * true startup boundary in this architecture — `proxy.ts` runs per request on
 * Edge, and layouts run per render, so neither can fail a deployment early.
 *
 * **This file must stay runtime-agnostic.** Because Next compiles it for Edge as
 * well as Node, anything Node-only that is *statically visible here* is analysed
 * against the Edge runtime even when a `NEXT_RUNTIME` check means it can never
 * execute there. `process.exit` sat in this file for exactly that reason and
 * produced a build warning: the guard is a runtime condition, and the analyser
 * reads the module. So the Node-only startup work lives in
 * `./instrumentation-node`, reached only through the conditional dynamic import
 * below — the pattern Next documents for runtime-specific instrumentation.
 *
 * Nothing here may statically import the environment modules, the logger, Redis,
 * or any other Node-only dependency.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    await registerNodeInstrumentation();
  }
}
