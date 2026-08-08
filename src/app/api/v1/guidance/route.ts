import { after } from "next/server";
import { requireApiUser } from "@/features/auth/guards";
import { recordEvent } from "@/features/analytics/events";
import { apiError, apiSuccess, fieldErrorsFrom } from "@/lib/api/response";
import { getEntitlements } from "@/features/billing/entitlements";
import { composerSchema } from "@/features/guidance/composer";
import { runGuidancePipeline } from "@/features/guidance/orchestrator";
import { countReportsThisPeriod, recordReportUsage } from "@/features/guidance/usage";
import { prisma } from "@/lib/db/prisma";
import { enforceApi } from "@/lib/rate-limit/enforce";
import { setContextActor } from "@/lib/observability/context";
import { withApiLogging } from "@/lib/observability/handler";
import { logger } from "@/lib/observability/logger";
import { getCompassProfile } from "@/features/onboarding/queries";
import { PROMPT_NAME, PROMPT_VERSION } from "@/features/guidance/ai/prompt";
import type { GuidanceInput, NormalizedConstraint } from "@/features/guidance/rules/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Creates a generation request and returns 202 with its id (spec section 11).
 *
 * The pipeline runs after the response is sent rather than holding the request
 * open; the client polls GET /api/v1/guidance/:id for named stages.
 */
export const POST = withApiLogging("/api/v1/guidance", async (request: Request) => {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  setContextActor(user.id);

  // After authentication so a rejected request never spends someone's budget,
  // and before parsing so an abusive caller cannot make us do work first.
  //
  // This is a burst ceiling, distinct from the monthly entitlement below. The
  // entitlement cannot stop a burst on its own: usage is charged only on
  // success and only after the response is sent, so several rapid submissions
  // all read a ledger that has not caught up.
  const limited = await enforceApi("guidanceGeneration", {
    headers: request.headers,
    userId: user.id,
  });
  if (limited) return limited;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return apiError("VALIDATION_FAILED", "That request is too large.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return apiError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }

  const parsed = composerSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", "Check the submitted question and criteria.", {
      fieldErrors: fieldErrorsFrom(parsed.error),
    });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.slice(0, 200);
  if (!idempotencyKey) {
    return apiError("VALIDATION_FAILED", "An Idempotency-Key header is required.");
  }

  // A repeated submission returns the original request instead of starting a
  // second generation and charging for it twice.
  const existing = await prisma.guidanceRequest.findUnique({
    where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    select: { id: true },
  });
  if (existing) {
    return apiSuccess({ requestId: existing.id }, { status: 202 });
  }

  // Entitlements are read server-side; nothing about the plan is taken from the
  // client (CLAUDE.md).
  const [entitlements, used] = await Promise.all([
    getEntitlements(user.id),
    countReportsThisPeriod(user.id),
  ]);

  if (used >= entitlements.monthlyReports) {
    return apiError(
      "RATE_LIMITED",
      "You have used this month's reports. Upgrade or wait for the next period.",
      { status: 429 },
    );
  }

  const profile = await getCompassProfile(user.id);

  const constraints: NormalizedConstraint[] = profile.constraints.map((constraint) => ({
    id: constraint.id,
    type: constraint.type as NormalizedConstraint["type"],
    value: constraint.value,
    isHard: constraint.type === "WORK_AUTHORIZATION",
  }));

  const input: GuidanceInput = {
    topic: parsed.data.topic,
    question: parsed.data.question,
    criteria: parsed.data.criteria,
    includeProfile: parsed.data.includeProfile,
    profile: {
      region: parsed.data.includeProfile ? profile.region : null,
      careerStage: parsed.data.includeProfile ? profile.careerStage : null,
      currentRole: parsed.data.includeProfile ? profile.currentRole : null,
      primaryGoal: parsed.data.includeProfile ? profile.primaryGoal : null,
      timeframe: parsed.data.includeProfile ? profile.timeframe : null,
    },
    constraints: parsed.data.includeProfile ? constraints : [],
  };

  const created = await prisma.guidanceRequest.create({
    data: {
      userId: user.id,
      topic: parsed.data.topic,
      question: parsed.data.question,
      status: "PENDING",
      // Immutable record of exactly what this version was built from.
      inputSnapshot: input as unknown as object,
      promptVersion: `${PROMPT_NAME}@${String(PROMPT_VERSION)}`,
      idempotencyKey,
    },
    select: { id: true },
  });

  // Topic and criteria count are analysable; the question text never is.
  await recordEvent("guidance_requested", user.id, {
    topic: parsed.data.topic,
    criteriaCount: parsed.data.criteria.length,
    includeProfile: parsed.data.includeProfile,
  });

  // Operational counterpart to the analytics event above. Topic is an enum and
  // the counts are integers; the question itself is never a log field.
  logger.info("guidance.accepted", {
    generationId: created.id,
    topic: parsed.data.topic,
    criteriaCount: parsed.data.criteria.length,
    includeProfile: parsed.data.includeProfile,
  });

  after(async () => {
    const startedAt = Date.now();
    const result = await runGuidancePipeline(created.id, input);

    // Usage is charged only on success — a failed generation is free.
    if (result.ok) {
      await recordReportUsage(user.id, created.id);
      await recordEvent("guidance_completed", user.id, {
        topic: parsed.data.topic,
        latencyMs: Date.now() - startedAt,
      });
      logger.info("guidance.completed", {
        generationId: created.id,
        topic: parsed.data.topic,
        durationMs: Date.now() - startedAt,
      });
    } else {
      await recordEvent("guidance_failed", user.id, { code: result.code });
      // The failure *code* is a closed enum from the pipeline. No provider
      // payload, model output, or exception message is recorded.
      logger.warn("guidance.failed", {
        generationId: created.id,
        topic: parsed.data.topic,
        failureCode: result.code,
        durationMs: Date.now() - startedAt,
      });
    }
  });

  return apiSuccess({ requestId: created.id }, { status: 202 });
});
