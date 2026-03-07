import { cn } from "@/lib/utils";

type StatusType = "open" | "reviewing" | "approved" | "executed" | "closed" | "pending" | "rejected" |
  "scheduled" | "disrupted" | "cancelled" | "rebooked" |
  "normal" | "busy" | "overloaded" | "maintenance" |
  "critical" | "high" | "medium" | "low";

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  open: { bg: "bg-info/15", text: "text-info", dot: "bg-info" },
  reviewing: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning" },
  approved: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
  executed: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
  closed: { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" },
  pending: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning animate-pulse-glow" },
  rejected: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive" },
  scheduled: { bg: "bg-info/15", text: "text-info", dot: "bg-info" },
  disrupted: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive animate-pulse-glow" },
  cancelled: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive" },
  rebooked: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
  normal: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
  busy: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning" },
  overloaded: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive animate-pulse-glow" },
  maintenance: { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" },
  critical: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive animate-pulse-glow" },
  high: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive" },
  medium: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning" },
  low: { bg: "bg-info/15", text: "text-info", dot: "bg-info" },
};

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.open;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", config.bg, config.text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {status}
    </span>
  );
}
