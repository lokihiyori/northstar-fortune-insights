import { LoadingPanel } from "@/components/ui/states";

export default function AppLoading() {
  return (
    <div className="mx-auto max-w-5xl">
      <LoadingPanel label="Loading your workspace" />
    </div>
  );
}
