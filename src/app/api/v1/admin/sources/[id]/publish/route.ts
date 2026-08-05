import { requireApiAdmin } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
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
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;

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
