"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DialogOverlay, type DialogContentProps } from "./dialog";
export {
  Dialog as Sheet,
  DialogTrigger as SheetTrigger,
  DialogClose as SheetClose,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
  DialogHeader as SheetHeader,
  DialogFooter as SheetFooter,
} from "./dialog";

export function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: DialogContentProps & { side?: "left" | "right" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn("sheet-content", className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            className="dialog-close"
            aria-label="Tutup panel"
          >
            <X size={18} aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}
