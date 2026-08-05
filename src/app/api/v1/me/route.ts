import { requireApiUser } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
import { compassCompletion, getCompassProfile } from "@/features/onboarding/queries";

export const runtime = "nodejs";
// Session-dependent, so it must never be cached or statically prerendered.
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireApiUser();
  if (!authResult.ok) return authResult.response;

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
  } catch {
    // Never leak a Prisma error or stack trace to the client.
    return apiError("INTERNAL", "We could not load your account right now.");
  }
}
