"use client";

import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

type TabsProps = Omit<
  ComponentProps<typeof TabsPrimitive.Root>,
  "className" | "value" | "defaultValue" | "onValueChange"
> & {
  className?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};
export function Tabs({ className, onValueChange, ...props }: TabsProps) {
  return (
    <TabsPrimitive.Root
      className={cn("ui-tabs", className)}
      onValueChange={
        onValueChange ? (value) => onValueChange(String(value)) : undefined
      }
      {...props}
    />
  );
}
export function TabsList({
  className,
  ...props
}: Omit<ComponentProps<typeof TabsPrimitive.List>, "className"> & {
  className?: string;
}) {
  return (
    <TabsPrimitive.List className={cn("ui-tabs-list", className)} {...props} />
  );
}
export function TabsTrigger({
  className,
  ...props
}: Omit<ComponentProps<typeof TabsPrimitive.Tab>, "className"> & {
  className?: string;
}) {
  return (
    <TabsPrimitive.Tab
      className={cn("ui-tabs-trigger", className)}
      {...props}
    />
  );
}
export function TabsContent({
  className,
  ...props
}: Omit<ComponentProps<typeof TabsPrimitive.Panel>, "className"> & {
  className?: string;
}) {
  return (
    <TabsPrimitive.Panel
      className={cn("ui-tabs-content", className)}
      {...props}
    />
  );
}
