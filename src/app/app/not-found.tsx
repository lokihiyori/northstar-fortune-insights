import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <EmptyState
        title="We could not find that"
        description="The insight or plan you asked for does not exist, or it belongs to another account."
        action={
          <>
            <ButtonLink href="/app/history">View your history</ButtonLink>
            <ButtonLink href="/app" variant="secondary">
              Back to dashboard
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}
