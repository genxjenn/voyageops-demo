import { cn } from "@/lib/utils";
import { type AgentRecommendation, type RecommendedAction } from "@/data/mockData";
import { StatusBadge } from "./StatusBadge";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp, Brain, DollarSign } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface RecommendationCardProps {
  recommendation: AgentRecommendation;
  className?: string;
}

export function RecommendationCard({ recommendation, className }: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(recommendation.status);

  const handleApprove = (action: RecommendedAction) => {
    toast.success(`Action approved: ${action.label}`, { description: "Action has been queued for execution." });
  };

  const handleReject = (action: RecommendedAction) => {
    toast.info(`Action rejected: ${action.label}`, { description: "Action has been logged and skipped." });
  };

  const handleApproveAll = () => {
    setStatus("approved");
    toast.success("All actions approved", { description: `${recommendation.actions.length} actions queued for execution.` });
  };

  return (
    <div className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">{recommendation.title}</h3>
            <StatusBadge status={status as any} />
            <StatusBadge status={recommendation.impact as any} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{recommendation.summary}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Brain className="h-3 w-3" />
            {recommendation.confidence}%
          </div>
        </div>
      </div>

      {/* Expandable reasoning */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 border-t border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Agent Reasoning & Data Sources
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-foreground mb-1">Reasoning</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{recommendation.reasoning}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground mb-1">Data Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {recommendation.dataSourcesUsed.map((ds) => (
                <span key={ds} className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{ds}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-border">
        <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
          <p className="text-xs font-medium text-foreground">Recommended Actions ({recommendation.actions.length})</p>
          {status === "pending" && (
            <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleApproveAll}>
              Approve All
            </Button>
          )}
        </div>
        <div className="divide-y divide-border">
          {recommendation.actions.map((action) => (
            <div key={action.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  {action.estimatedValue && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-success">
                      <DollarSign className="h-3 w-3" />{action.estimatedValue.toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-success hover:bg-success/10" onClick={() => handleApprove(action)}>
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10" onClick={() => handleReject(action)}>
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
