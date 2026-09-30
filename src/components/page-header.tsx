import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("page-header", className)}>
      <div className="page-header-copy">
        {eyebrow && <p className="text-kicker">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <div className="page-description">{description}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
