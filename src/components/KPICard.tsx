import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { type OperationalKPI } from "@/data/mockData";

interface KPICardProps {
  kpi: OperationalKPI;
  className?: string;
  compact?: boolean;
}

export function KPICard({ kpi, className, compact }: KPICardProps) {
  const trendColor = kpi.trend === "up" ? "text-success" : kpi.trend === "down" ? "text-destructive" : "text-muted-foreground";
  const TrendIcon = kpi.trend === "up" ? TrendingUp : kpi.trend === "down" ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:glow-primary",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <p
        className={cn(
          "font-medium uppercase tracking-wider text-muted-foreground",
          compact ? "text-[10px] leading-tight" : "text-xs",
        )}
      >
        {kpi.label}
      </p>
      <div className={cn("flex", compact ? "mt-1.5 flex-col gap-1" : "mt-2 items-end justify-between")}>
        <span className={cn("font-bold text-foreground", compact ? "text-lg" : "text-2xl")}>{kpi.value}</span>
        {kpi.change !== undefined && (
          <div className={cn("flex items-center gap-1 font-medium", compact ? "text-[10px]" : "text-xs", trendColor)}>
            <TrendIcon className="h-3 w-3 shrink-0" />
            <span className="leading-tight">
              {kpi.change > 0 ? "+" : ""}{kpi.change} {kpi.changeLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
