import "server-only";

import { prisma } from "@/lib/db/prisma";
import { logFailure } from "@/lib/observability/logger";
import { errorName } from "@/lib/observability/redact";
import { stripPrivateProperties, type EventName, type EventProperties } from "./event-names";

export { EVENT_NAMES } from "./event-names";
export type { EventName, EventProperties } from "./event-names";

/**
 * Records a funnel event. Question text, report prose, plan notes, and feedback
 * comments never become event properties — only counts, enums, and durations.
 */
export async function recordEvent(
  eventName: EventName,
  userId: string | null,
  properties: EventProperties = {},
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        eventName,
        userId,
        // Defence in depth, in case a caller passes a private field by mistake.
        properties: stripPrivateProperties(properties) as object,
      },
    });
  } catch (error) {
    // Analytics must never break a user flow. The event *name* is a closed enum
    // and safe; the properties are not re-logged, since the failure is about
    // the write and not about what was being written.
    logFailure("analytics.write_failed", "internal", {
      analyticsEvent: eventName,
      errorType: errorName(error),
    });
  }
}
