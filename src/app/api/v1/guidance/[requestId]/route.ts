import { requireApiUser } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getRequestForUser } from "@/features/guidance/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled status for a generation request.
 *
 * Returns only presentation-safe fields: the named stage index and, once ready,
 * the report id. No model output, no provider payload, and no reasoning ever
 * passes through here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { requestId } = await params;
  const record = await getRequestForUser(requestId, auth.user.id);

  // Scoped by userId, so another account's request is simply not found.
  if (!record) return apiError("NOT_FOUND", "That request does not exist.");

  return apiSuccess({
    status: record.status,
    stageIndex: record.stageIndex,
    reportId: record.reports[0]?.id ?? null,
    message: record.status === "FAILED" ? record.errorMessage : null,
  });
}
