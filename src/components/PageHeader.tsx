import type { ReactNode } from "react";
import { PageInstructions } from "@/components/PageInstructions";

export function PageHeader({
  title,
  description,
  action,
  icon,
  instructions = true,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  /** Set false to hide the automatic "how to use this page" block. */
  instructions?: boolean;
}) {
  return (
    <div className="mb-5 sm:mb-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div className="max-w-3xl min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight flex items-center gap-2 sm:gap-3">
            {icon}
            <span className="truncate">{title}</span>
          </h1>
          {description && (
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
        {action}
      </div>
      {instructions && <PageInstructions />}
    </div>
  );
}
