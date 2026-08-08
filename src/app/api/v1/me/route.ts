import { requireApiUser } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enforceApi } from "@/lib/rate-limit/enforce";
import { setContextActor } from "@/lib/observability/context";
import { withApiLogging } from "@/lib/observability/handler";
import { captureException } from "@/lib/observability/monitoring";
import { compassCompletion, getCompassProfile } from "@/features/onboarding/queries";

export const runtime = "nodejs";
// Session-dependent, so it must never be cached or statically prerendered.
export const dynamic = "force-dynamic";

export const GET = withApiLogging("/api/v1/me", async (request: Request) => {
  const authResult = await requireApiUser();
  if (!authResult.ok) return authResult.response;
  setContextActor(authResult.user.id);

  // An ordinary read, so this limit is **fail-open**: if Redis is down the
  // account still loads. PostgreSQL is the source of truth and a cache outage
  // must cost protection, never availability (ADR 0004).
  const limited = await enforceApi("accountRead", {
    headers: request.headers,
    userId: authResult.user.id,
  });
  if (limited) return limited;

  try {
    const profile = await getCompassProfile(authResult.user.id);

    return apiSuccess({
      user: {
        id: authResult.user.id,
        email: authResult.user.email,
        name: authResult.user.name ?? null,
        role: authResult.user.role,
      },
      compass: {
        region: profile.region,
        careerStage: profile.careerStage,
        primaryGoal: profile.primaryGoal,
        timeframe: profile.timeframe,
        priorities: profile.priorities,
        constraintCount: profile.constraints.length,
        onboardingStep: profile.onboardingStep,
        onboardingComplete: Boolean(profile.onboardingCompletedAt),
        completion: compassCompletion(profile),
      },
      // Phase 6 derives these from the subscription; hard-coded to the free
      // plan until then rather than pretending the field does not exist.
      entitlements: {
        plan: "free",
        monthlyReports: 3,
        maxActivePlans: 1,
      },
    });
  } catch (error) {
    // Never leak a Prisma error or stack trace to the client. The exception
    // itself goes to the monitoring boundary, which records its *name* and the
    // request id — never its message, which can carry a connection string.
    captureException(error, { category: "internal" });
    return apiError("INTERNAL", "We could not load your account right now.");
  }
});
