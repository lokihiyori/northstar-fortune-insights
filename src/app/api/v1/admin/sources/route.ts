import { requireApiAdmin } from "@/features/auth/guards";
import { apiError, apiSuccess, fieldErrorsFrom } from "@/lib/api/response";
import { enforceApi } from "@/lib/rate-limit/enforce";
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
export async function GET() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;

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
}

export async function POST(request: Request) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;

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

  return apiSuccess({ id: result.value.id }, { status: 201 });
}
