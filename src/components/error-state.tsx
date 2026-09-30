"use client";

import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "./ui/button";

export function ErrorState({
  title = "Data belum dapat dimuat",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert aria-hidden="true" size={20} />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw size={14} aria-hidden="true" />
            Coba lagi
          </Button>
        )}
      </div>
    </div>
  );
}
