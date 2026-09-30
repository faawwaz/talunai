import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <span className="ui-select-wrap">
      <select
        data-slot="select"
        className={cn("ui-input ui-select", className)}
        {...props}
      />
      <ChevronDown aria-hidden="true" className="ui-select-chevron" size={16} />
    </span>
  );
}
export { Select as NativeSelect };
