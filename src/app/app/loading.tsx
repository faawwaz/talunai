import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Memuat workspace" className="page-stack">
      <span className="sr-only">Memuat workspace…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
