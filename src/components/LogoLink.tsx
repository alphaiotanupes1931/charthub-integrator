import { Link } from "@tanstack/react-router";
import logoAsset from "@/assets/logo.png.asset.json";
import { cn } from "@/lib/utils";

type LogoLinkProps = {
  to: string;
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  variant?: "default" | "brand";
  glow?: boolean;
  className?: string;
  imgClassName?: string;
  textClassName?: string;
};

const SIZE_IMG: Record<string, string> = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-14 w-14 sm:h-16 sm:w-16",
};

const SIZE_TEXT: Record<string, string> = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-2xl sm:text-3xl",
};

export function LogoLink({
  to,
  size = "md",
  showText = true,
  variant = "default",
  glow = false,
  className,
  imgClassName,
  textClassName,
}: LogoLinkProps) {
  const img = (
    <img
      src={logoAsset.url}
      alt="TradeMind"
      className={cn("object-contain shrink-0", glow && "relative", SIZE_IMG[size], imgClassName)}
    />
  );

  return (
    <Link to={to} className={cn("flex items-center gap-2 min-w-0", className)}>
      {glow ? (
        <div className="relative shrink-0">
          <div className="absolute inset-0 rounded-full blur-md bg-primary/40" />
          {img}
        </div>
      ) : (
        img
      )}
      {showText && (
        <span className="min-w-0 flex flex-col leading-none">
          <span className={cn("font-display font-semibold tracking-tight truncate", SIZE_TEXT[size], textClassName)}>
            {variant === "brand" ? (
              <>
                <span className="text-foreground">Trade</span>
                <span className="text-gold-gradient">Mind</span>
              </>
            ) : (
              "TradeMind"
            )}
          </span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Beta
          </span>
        </span>
      )}

    </Link>
  );
}
