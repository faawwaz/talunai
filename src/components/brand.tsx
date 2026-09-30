import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("brand", className)}>
      <svg
        className="brand-symbol"
        viewBox="0 0 30 34"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M15 31V14"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M15 18C6.7 17.7 2.5 12.9 2.5 5.5C10.8 5.8 15 10.6 15 18Z"
          fill="currentColor"
        />
        <path
          d="M15 24C23.3 23.7 27.5 18.9 27.5 11.5C19.2 11.8 15 16.6 15 24Z"
          fill="currentColor"
        />
        <path
          d="M15 10.5C12.8 7.5 13.2 4.2 16.1 1C18.3 4 17.9 7.3 15 10.5Z"
          fill="currentColor"
        />
      </svg>
      {!compact && (
        <span className="brand-wordmark">
          talunai<span aria-hidden="true">.</span>
        </span>
      )}
    </span>
  );
}
