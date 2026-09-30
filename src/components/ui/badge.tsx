import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("ui-badge", {
  variants: {
    variant: {
      default: "ui-badge-neutral",
      secondary: "ui-badge-neutral",
      outline: "ui-badge-outline",
      success: "ui-badge-success",
      warning: "ui-badge-warning",
      destructive: "ui-badge-danger",
      info: "ui-badge-info",
    },
  },
  defaultVariants: { variant: "default" },
});
export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
