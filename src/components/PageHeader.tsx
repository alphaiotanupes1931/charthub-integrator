import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold tracking-tight flex items-center gap-3">
          {icon}
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
