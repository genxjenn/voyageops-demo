import { RecommendationCard } from "@/components/RecommendationCard";
import { AgentTimeline } from "@/components/AgentTimeline";
import { AgentChat } from "@/components/AgentChat";
import { StatusBadge } from "@/components/StatusBadge";
import { guests, incidents, agentRecommendations, guestRecoveryTimeline } from "@/data/mockData";
import { User, Crown, CreditCard, Ship, MessageSquare, Star } from "lucide-react";

const GuestRecoveryAgent = () => {
  const recs = agentRecommendations.filter(r => r.agentType === "guest-recovery");
  const guest = guests[0]; // Jane Doe - primary scenario
  const incident = incidents[0];

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Guest Service Recovery Agent</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Detect service failures, correlate guest data, and recommend recovery actions</p>
      </div>

      {/* NLP Chat Interface */}
      <AgentChat agentType="guest-recovery" className="h-[520px]" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Guest Profile & Incident */}
        <div className="space-y-4">
          {/* Guest Profile */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Guest Profile</h2>
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">{guest.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Crown className="h-3 w-3 text-warning" />
                  <span className="text-xs font-medium text-warning">{guest.loyaltyTier}</span>
                  <span className="text-xs text-muted-foreground">· {guest.loyaltyNumber}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground">Cabin</span>
                <p className="font-medium text-foreground">{guest.cabinNumber}</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground">Booking</span>
                <p className="font-medium text-foreground">{guest.bookingId}</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground flex items-center gap-1"><CreditCard className="h-3 w-3" />Onboard Spend</span>
                <p className="font-medium text-foreground">${guest.onboardSpend.toLocaleString()}</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground flex items-center gap-1"><Ship className="h-3 w-3" />Sailing History</span>
                <p className="font-medium text-foreground">{guest.sailingHistory} voyages</p>
              </div>
            </div>
            <div className="mt-3 rounded bg-muted p-2 text-xs">
              <span className="text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3" />Guest Notes</span>
              <p className="text-foreground mt-0.5">Prefers window tables. Celebrates anniversary on Day 6. Wine enthusiast (Bordeaux). First complaint in 12 sailings.</p>
            </div>
          </div>

          {/* Active Incident */}
          <div className="rounded-lg border border-destructive/30 bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-destructive" /> Active Incident
            </h2>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono text-muted-foreground">{incident.id}</span>
              <StatusBadge status={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>
            <p className="text-sm font-medium text-foreground">{incident.type}: {incident.category}</p>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{incident.description}</p>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span>Reported: {new Date(incident.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
              <span>Updated: {new Date(incident.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>

          {/* All Active Incidents */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">All Guest Incidents ({incidents.length})</h2>
            <div className="space-y-2">
              {incidents.map(inc => (
                <div key={inc.id} className="flex items-center justify-between gap-2 rounded bg-muted p-2 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-muted-foreground">{inc.id}</span>
                      <StatusBadge status={inc.severity} />
                    </div>
                    <p className="text-foreground mt-0.5 truncate">{inc.type}: {inc.category}</p>
                  </div>
                  <StatusBadge status={inc.status} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Column - Recommendations */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Agent Recommendations ({recs.length})</h2>
          {recs.map(rec => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>

        {/* Right Column - Timeline */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Activity Timeline</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <AgentTimeline events={guestRecoveryTimeline} />
          </div>

          {/* Demo Scenario */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Demo Scenario</h3>
            <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
              <p><strong className="text-foreground">Trigger:</strong> Platinum guest Jane Doe filed a dining complaint after a 45-minute wait at Le Bordeaux, despite having a priority reservation.</p>
               <p><strong className="text-foreground">Analysis:</strong> The agent correlated her loyalty tier (Platinum, 12 voyages), onboard spend ($4,820 — top 5%), and the fact this is her first complaint ever, with venue data showing Le Bordeaux at 96% capacity with 25% understaffing.</p>
              <p><strong className="text-foreground">Recommendation:</strong> 4-action recovery plan including $200 credit, personal Hotel Director apology, complimentary Chef's Table dinner, and priority reservation guarantee.</p>
              <p><strong className="text-foreground">Outcome:</strong> Estimated $58,000+ lifetime value protected. Churn risk reduced from 34% to under 5%.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuestRecoveryAgent;
