import { requireApiAdmin } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enforceApi } from "@/lib/rate-limit/enforce";
import { transitionSource } from "@/features/sources/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publishes a reviewed source (spec section 11).
 *
 * Delegates to the same service the admin UI uses, so the publish gate,
 * audit record, and retrieval-cache invalidation cannot diverge between the two
 * entry points.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;

  // Publishing invalidates the retrieval cache for the whole corpus, so a loop
  // here is expensive well beyond this one row.
  const limited = await enforceApi("adminMutation", {
    headers: request.headers,
    userId: auth.user.id,
  });
  if (limited) return limited;

  const { id } = await params;

  const result = await transitionSource(
    { id: auth.user.id, email: auth.user.email },
    id,
    "PUBLISHED",
  );

  if (!result.ok) {
    if (result.reason.includes("no longer exists")) {
      return apiError("NOT_FOUND", result.reason);
    }
    // A refused transition is a state conflict, not a malformed request.
    return apiError("CONFLICT", result.reason);
  }

  return apiSuccess({ id, status: result.value.status });
}
