import { SourceForm } from "@/components/admin/source-form";
import { ButtonLink } from "@/components/ui/button";
import { requireAdmin } from "@/features/auth/guards";

export const metadata = { title: "Add source" };

export default async function NewSourcePage() {
  await requireAdmin("/admin/sources/new");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Add a source</h1>
      <p className="text-text-secondary mt-2">
        New sources start as a draft. They become retrievable only after review and publishing.
      </p>

      <div className="border-border bg-surface rounded-card mt-8 border p-6">
        <SourceForm mode="create" />
      </div>

      <div className="mt-6">
        <ButtonLink href="/admin/sources" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </div>
  );
}
