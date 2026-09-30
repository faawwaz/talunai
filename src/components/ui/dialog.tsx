"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger> & {
  asChild?: boolean;
}) {
  return (
    <DialogPrimitive.Trigger
      {...props}
      render={
        asChild && React.isValidElement(children) ? children : props.render
      }
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Trigger>
  );
}
export function DialogClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close> & { asChild?: boolean }) {
  return (
    <DialogPrimitive.Close
      {...props}
      render={
        asChild && React.isValidElement(children) ? children : props.render
      }
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Close>
  );
}
export function DialogOverlay({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Backdrop>, "className"> & {
  className?: string;
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn("dialog-backdrop", className)}
      {...props}
    />
  );
}
export type DialogContentProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Popup>,
  "className"
> & {
  className?: string;
  showCloseButton?: boolean;
};
export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Viewport className="dialog-viewport">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn("dialog-content", className)}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              className="dialog-close"
              aria-label="Tutup dialog"
            >
              <X size={18} aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}
export function DialogTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Title>, "className"> & {
  className?: string;
}) {
  return (
    <DialogPrimitive.Title
      className={cn("dialog-title", className)}
      {...props}
    />
  );
}
export function DialogDescription({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof DialogPrimitive.Description>,
  "className"
> & { className?: string }) {
  return (
    <DialogPrimitive.Description
      className={cn("dialog-description", className)}
      {...props}
    />
  );
}
export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("dialog-header", className)} {...props} />;
}
export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("dialog-footer", className)} {...props} />;
}
