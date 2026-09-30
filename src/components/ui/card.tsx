import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section data-slot="card" className={cn("surface", className)} {...props} />
  );
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("surface-header", className)}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn("section-heading", className)}
      {...props}
    />
  );
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("surface-content", className)}
      {...props}
    />
  );
}
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("surface-footer", className)}
      {...props}
    />
  );
}
