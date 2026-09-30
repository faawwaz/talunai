import type { ReactNode } from "react";
import { FileText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = FileText,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("empty-state", className)}>
      <div className="empty-state-symbol">
        <Icon size={24} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
