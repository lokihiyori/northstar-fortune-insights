import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);

/**
 * Restores the demo account before the demo suite runs, by invoking the real
 * `pnpm demo:reset` command — the same thing an operator does before showing
 * the demo.
 *
 * A child process rather than an in-process call: the generated Prisma client
 * uses `import.meta`, which Playwright's transform cannot load, which is also
 * why `helpers/db.ts` talks to PostgreSQL through `pg` directly. Shelling out
 * has the happy side effect of exercising the operator command itself.
 *
 * This is not a workaround for a flaky test. The demo account is *shared* and
 * its state is cumulative: the Free plan allows three reports a month, and a
 * previous run's generations count against it, after which the Generate button
 * is correctly disabled. Resetting first is the documented operating procedure
 * (`docs/demo.md`), so the suite follows it rather than working around the
 * entitlement system.
 */
export async function resetDemoForTests(): Promise<void> {
  const cwd = path.resolve(__dirname, "../../..");
  const { stdout } = await run("pnpm", ["demo:reset"], { cwd, shell: true });

  if (!stdout.includes("demo:reset complete")) {
    throw new Error(`demo:reset did not complete:\n${stdout}`);
  }
}
