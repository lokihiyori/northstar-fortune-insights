import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GenerationProgress } from "@/components/guidance/generation-progress";
import { requireUser } from "@/features/auth/guards";
import { getRequestForUser } from "@/features/guidance/queries";

export const metadata: Metadata = {
  title: "Preparing your insight",
};

export default async function GenerationPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const user = await requireUser(`/app/ask/${requestId}`);

  // Ownership is checked here, not only in the polling endpoint, so a request
  // belonging to someone else is indistinguishable from one that never existed.
  const request = await getRequestForUser(requestId, user.id);
  if (!request) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <GenerationProgress requestId={requestId} />
    </div>
  );
}
