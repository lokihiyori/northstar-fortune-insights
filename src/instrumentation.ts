/**
 * Next.js runs `register()` once per server instance, and it must complete
 * before the server accepts requests. That makes it the only true startup
 * boundary in this architecture — `proxy.ts` runs per request on Edge, and
 * layouts run per render, so neither can fail a deployment early.
 *
 * Phase 8A wires environment validation here so a misconfigured deployment
 * fails immediately, naming the offending variable and never printing values.
 */
export async function register(): Promise<void> {
  // Only the Node.js runtime has the full environment. The Edge runtime gets a
  // restricted subset, and validating there would produce false failures.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the Edge bundle never pulls in server-only code.
  const { assertServerEnv } = await import("./lib/env/server");

  try {
    assertServerEnv();
  } catch (error) {
    const issues =
      error instanceof Error && "issues" in error && Array.isArray(error.issues)
        ? (error.issues as string[])
        : [error instanceof Error ? error.message : String(error)];

    // Variable names and rules only — never the offending values.
    console.error("[env] Startup validation failed:");
    for (const issue of issues) console.error(`  - ${issue}`);

    const isProductionRuntime =
      process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

    if (isProductionRuntime) {
      // Observed behaviour without this: Next catches the rejection, refuses
      // every request, but leaves the process running. Traffic is safely
      // rejected, yet a supervisor sees a live process rather than a failed
      // one and never restarts or alerts. Exiting makes the failure legible to
      // systemd, Docker, and orchestrators.
      console.error("[env] Refusing to start. Fix the variables above and redeploy.");
      process.exit(1);
    }

    // Development and test: rethrow so the error surfaces in the terminal
    // without killing a watch process the developer is iterating in.
    throw error;
  }
}
