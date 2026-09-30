"use client";

import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-primary",
      secondary: "ui-button-secondary",
      outline: "ui-button-outline",
      ghost: "ui-button-ghost",
      destructive: "ui-button-destructive",
    },
    size: {
      default: "ui-button-default",
      lg: "ui-button-lg",
      sm: "ui-button-sm",
      icon: "ui-button-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    render?: React.ReactElement;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  render,
  children,
  type,
  ...props
}: ButtonProps) {
  const rendered =
    asChild && React.isValidElement(children) ? children : render;
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      nativeButton={!rendered}
      render={rendered}
      type={rendered ? undefined : (type ?? "button")}
      {...props}
    >
      {asChild ? undefined : children}
    </ButtonPrimitive>
  );
}
