import { deleteTestUsers } from "./helpers/db";

/**
 * Removes every account the suite created. Runs even after failures, so a
 * crashed run cannot leave rows that break the next one.
 */
export default async function globalTeardown(): Promise<void> {
  const removed = await deleteTestUsers();
  console.log(`e2e teardown: removed ${String(removed)} test user(s)`);
}
