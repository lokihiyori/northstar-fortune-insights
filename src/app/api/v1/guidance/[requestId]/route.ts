import { requireApiUser } from "@/features/auth/guards";
import { apiError, apiSuccess } from "@/lib/api/response";
import { withApiLogging } from "@/lib/observability/handler";
import { setContextActor } from "@/lib/observability/context";
import { getRequestForUser } from "@/features/guidance/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled status for a generation request.
 *
 * Returns only presentation-safe fields: the named stage index and, once ready,
 * the report id. No model output, no provider payload, and no reasoning ever
 * passes through here.
 *
 * Success logging is off: the progress panel polls this every 1.2 seconds, so
 * one generation would produce fifty log lines saying nothing happened.
 */
export const GET = withApiLogging(
  "/api/v1/guidance/[requestId]",
  async (_request: Request, { params }: { params: Promise<{ requestId: string }> }) => {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;
    setContextActor(auth.user.id);

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
  },
  { logSuccess: false },
);
