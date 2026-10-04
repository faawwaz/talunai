import type { ReactNode } from "react";

// Presentational surfaces shared by authenticated Deals and the public replay.
// Keep this module free of session hooks, network calls and wallet providers.
export function DetailFacts({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-1 border-b border-border py-3.5 last:border-b-0 sm:flex-row sm:justify-between sm:gap-6"
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm font-medium sm:max-w-[65%] sm:text-right">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function NextActionSurface({
  title,
  description,
  action,
  held = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  held?: boolean;
}) {
  return (
    <div
      className={`flex flex-col justify-between gap-5 rounded-lg p-5 sm:flex-row sm:items-center ${held ? "bg-[#FFF3DF]" : "bg-secondary"}`}
    >
      <div className="max-w-2xl">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Langkah berikutnya
        </p>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
