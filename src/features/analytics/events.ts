import "server-only";

import { prisma } from "@/lib/db/prisma";
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
    // Analytics must never break a user flow.
    console.error(`Failed to record analytics event ${eventName}:`, error);
  }
}
