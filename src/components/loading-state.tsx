import { LoaderCircle } from "lucide-react";
import { Skeleton } from "./ui/skeleton";

export function LoadingState({
  label = "Memuat data workspace…",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  if (compact)
    return (
      <div className="loading-inline" role="status">
        <LoaderCircle
          className="loading-spinner"
          size={16}
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
    );
  return (
    <div className="loading-state" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-44" />
      <div className="loading-rows">
        {[0, 1, 2].map((index) => (
          <div key={index} className="loading-row">
            <Skeleton className="h-10 w-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
