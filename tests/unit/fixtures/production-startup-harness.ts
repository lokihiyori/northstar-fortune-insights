/**
 * A real process that performs the Node startup path, for the production
 * invalid-environment proof in `tests/unit/instrumentation-runtime.test.ts`.
 *
 * Spawned as a child rather than exercised in-process because the property
 * under test *is* the process outcome: `process.exit(1)`. A test that stubbed
 * `process.exit` would prove the call happened, not that a misconfigured
 * production server actually dies — which is the contract ADR 0007 records.
 *
 * It calls the same `registerNodeInstrumentation()` the server calls. No
 * validation is re-implemented here, and nothing about the environment is
 * fabricated beyond what the spawning test passes in.
 *
 * Run with `--conditions=react-server` so the `server-only` marker resolves to
 * its empty module, exactly as it does inside a Next server build. Without it
 * that package throws on import and the exit code would prove nothing.
 */
import { registerNodeInstrumentation } from "../../../src/instrumentation-node";

async function main(): Promise<void> {
  await registerNodeInstrumentation();

  /*
   * Only reachable when `registerNodeInstrumentation()` returned normally, so
   * the production case under test must never get here and its absence makes a
   * false pass loud rather than silent.
   *
   * The marker means "Node startup instrumentation completed" and nothing more.
   * This harness is not a Next server: it opens no HTTP listener, so the marker
   * says nothing about whether a real server would bind a port.
   */
  console.log("HARNESS_REACHED_READY");
}

main().catch((error: unknown) => {
  // The development/test contract: the error is rethrown rather than exited on.
  // Reported with its name only — the message can quote a variable name, never
  // a value, and this keeps the distinction visible in the child's output.
  console.error(`HARNESS_THREW ${error instanceof Error ? error.name : "unknown"}`);
  process.exitCode = 9;
});
