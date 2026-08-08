import { requireApiAdmin } from "@/features/auth/guards";
import { apiError, apiSuccess, fieldErrorsFrom } from "@/lib/api/response";
import { enforceApi } from "@/lib/rate-limit/enforce";
import { setContextActor } from "@/lib/observability/context";
import { withApiLogging } from "@/lib/observability/handler";
import { logger } from "@/lib/observability/logger";
import { createSource } from "@/features/sources/service";
import { createSourceSchema } from "@/features/sources/validation";
import { listSourcesForAdmin } from "@/features/sources/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Admin source API (spec section 11).
 *
 * `requireApiAdmin` is called here independently of the page guards — a Route
 * Handler is its own entry point. A signed-in non-admin gets the standard 403
 * envelope, not a redirect, because an API must answer with a status code.
 */
export const GET = withApiLogging("/api/v1/admin/sources", async () => {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  setContextActor(auth.user.id);

  const sources = await listSourcesForAdmin();

  return apiSuccess(
    sources.map((source) => ({
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      region: source.region,
      topic: source.topic,
      status: source.status,
      canonicalUrl: source.canonicalUrl,
      chunkCount: source._count.chunks,
      citationCount: source._count.citations,
    })),
  );
});

export const POST = withApiLogging("/api/v1/admin/sources", async (request: Request) => {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  setContextActor(auth.user.id);

  // Same ceiling as the admin UI's server action, applied here because a Route
  // Handler is its own entry point — exactly like the authorization check above.
  const limited = await enforceApi("adminMutation", {
    headers: request.headers,
    userId: auth.user.id,
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

  const parsed = createSourceSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", "Check the submitted source metadata.", {
      fieldErrors: fieldErrorsFrom(parsed.error),
    });
  }

  const result = await createSource({ id: auth.user.id, email: auth.user.email }, parsed.data);

  if (!result.ok) {
    // A duplicate canonical URL is a conflict, not a malformed request.
    const conflict = result.reason.includes("already");
    return apiError(conflict ? "CONFLICT" : "VALIDATION_FAILED", result.reason);
  }

  // Ids and the topic enum only. Title, publisher, URL, and content stay out of
  // the log: source text is evidence, and evidence is not operational data.
  logger.info("source.created", { sourceId: result.value.id, topic: parsed.data.topic });

  return apiSuccess({ id: result.value.id }, { status: 201 });
});
