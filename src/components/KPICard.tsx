import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { type OperationalKPI } from "@/data/mockData";

interface KPICardProps {
  kpi: OperationalKPI;
  className?: string;
}

export function KPICard({ kpi, className }: KPICardProps) {
  const trendColor = kpi.trend === "up" ? "text-success" : kpi.trend === "down" ? "text-destructive" : "text-muted-foreground";
  const TrendIcon = kpi.trend === "up" ? TrendingUp : kpi.trend === "down" ? TrendingDown : Minus;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:glow-primary", className)}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
        {kpi.change !== undefined && (
          <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            <span>{kpi.change > 0 ? "+" : ""}{kpi.change} {kpi.changeLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
