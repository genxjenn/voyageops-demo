import { RecommendationCard } from "@/components/RecommendationCard";
import { AgentTimeline } from "@/components/AgentTimeline";
import { AgentChat } from "@/components/AgentChat";
import { StatusBadge } from "@/components/StatusBadge";
import { venues, agentRecommendations, onboardOpsTimeline } from "@/data/mockData";
import { Users, Clock, Wrench, TrendingUp } from "lucide-react";

const OnboardOpsAgent = () => {
  const recs = agentRecommendations.filter(r => r.agentType === "onboard-ops");

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Onboard Operations Optimization Agent</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Monitor venue demand, staffing, and maintenance to optimize guest experience in real time</p>
      </div>

      {/* NLP Chat Interface */}
      <AgentChat agentType="onboard-ops" className="h-[520px]" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left - Venue Status */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Venue Utilization</h2>
            <div className="space-y-2">
              {venues.map(venue => {
                const occupancyPct = Math.round((venue.currentOccupancy / venue.capacity) * 100);
                const staffGap = venue.optimalStaff - venue.staffCount;
                return (
                  <div key={venue.id} className="rounded border border-border bg-muted p-3 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-foreground">{venue.name}</span>
                        <span className="ml-2 text-muted-foreground">{venue.type} · Deck {venue.deck}</span>
                      </div>
                      <StatusBadge status={venue.status} />
                    </div>
                    {/* Occupancy Bar */}
                    <div className="mb-2">
                      <div className="flex justify-between text-muted-foreground mb-0.5">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{venue.currentOccupancy}/{venue.capacity}</span>
                        <span>{occupancyPct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary">
                        <div
                          className={`h-full rounded-full transition-all ${occupancyPct > 90 ? "bg-destructive" : occupancyPct > 70 ? "bg-warning" : "bg-success"}`}
                          style={{ width: `${Math.min(occupancyPct, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex gap-4 text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Wait: {venue.waitTime}min</span>
                      <span className={`flex items-center gap-1 ${staffGap > 0 ? "text-destructive" : "text-success"}`}>
                        <TrendingUp className="h-3 w-3" />Staff: {venue.staffCount}/{venue.optimalStaff}
                        {staffGap > 0 && <span className="text-destructive">(-{staffGap})</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Maintenance Flags */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5" /> Maintenance Flags
            </h2>
            <div className="space-y-2 text-xs">
              {[
                { item: "Grand Theater — Stage lighting rig", priority: "high" as const, eta: "In progress" },
                { item: "Sky Pool — Filtration system", priority: "medium" as const, eta: "Scheduled 23:00" },
                { item: "Deck 7 elevator #3", priority: "low" as const, eta: "Tomorrow AM" },
              ].map(m => (
                <div key={m.item} className="flex items-center justify-between rounded bg-muted p-2">
                  <div>
                    <p className="text-foreground">{m.item}</p>
                    <p className="text-muted-foreground">{m.eta}</p>
                  </div>
                  <StatusBadge status={m.priority} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center - Recommendations */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Agent Recommendations ({recs.length})</h2>
          {recs.map(rec => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>

        {/* Right - Timeline & Demo */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Activity Timeline</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <AgentTimeline events={onboardOpsTimeline} />
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Demo Scenario</h3>
            <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
              <p><strong className="text-foreground">Trigger:</strong> Le Bordeaux crossed 90% capacity threshold with staff-to-guest ratio below minimum during sea day dinner peak.</p>
              <p><strong className="text-foreground">Analysis:</strong> Agent scanned all 8 venues, identified Compass Bar at 43% occupancy with 2 excess staff, while Le Bordeaux needed 4 additional staff. Predicted capacity overflow in 25 minutes.</p>
              <p><strong className="text-foreground">Recommendation:</strong> Redeploy 4 staff from Compass Bar, open Atlas Lounge overflow, push targeted Compass Bar promo to Lido queue, extend Ocean Grill hours.</p>
              <p><strong className="text-foreground">Outcome:</strong> Average dining wait time reduced from 35 to 12 minutes. Guest satisfaction scores for dining held at 4.2/5.0. Zero capacity overflows.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardOpsAgent;
