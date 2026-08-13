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
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
  xl: "h-11 w-11",
};

const SIZE_TEXT: Record<string, string> = {
  sm: "text-[15px]",
  md: "text-base",
  lg: "text-xl",
  xl: "text-2xl",
};

export function LogoLink({
  to,
  size = "md",
  showText = true,
  className,
  imgClassName,
  textClassName,
}: LogoLinkProps) {
  return (
    <Link to={to} className={cn("flex items-center gap-2 min-w-0", className)}>
      <img
        src={logoAsset.url}
        alt="TradeMind"
        className={cn("object-contain shrink-0", SIZE_IMG[size], imgClassName)}
      />
      {showText && (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn("font-display font-medium tracking-tight text-foreground truncate", SIZE_TEXT[size], textClassName)}>
            TradeMind
          </span>
          <span className="shrink-0 text-[10px] font-normal lowercase tracking-normal text-muted-foreground">
            beta
          </span>
        </span>
      )}
    </Link>
  );
}
