import { cn } from "@/lib/utils";
import { type TimelineEvent } from "@/data/mockData";
import { AlertTriangle, Brain, Lightbulb, CheckCircle2, Info, Zap } from "lucide-react";

const iconMap: Record<TimelineEvent["type"], React.ElementType> = {
  alert: AlertTriangle,
  analysis: Brain,
  recommendation: Lightbulb,
  action: CheckCircle2,
  resolution: Zap,
  info: Info,
};

const colorMap: Record<TimelineEvent["type"], string> = {
  alert: "text-destructive border-destructive/30",
  analysis: "text-info border-info/30",
  recommendation: "text-primary border-primary/30",
  action: "text-success border-success/30",
  resolution: "text-success border-success/30",
  info: "text-muted-foreground border-muted-foreground/30",
};

interface AgentTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export function AgentTimeline({ events, className }: AgentTimelineProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {events.map((event, i) => {
        const Icon = iconMap[event.type];
        const color = colorMap[event.type];
        const time = new Date(event.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

        return (
          <div key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card", color)}>
                <Icon className="h-4 w-4" />
              </div>
              {i < events.length - 1 && <div className="w-px flex-1 bg-border" />}
            </div>
            <div className="pb-6">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <span className="text-xs text-muted-foreground">{time}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
              {event.actor && <p className="mt-1 text-xs text-primary/70">— {event.actor}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
