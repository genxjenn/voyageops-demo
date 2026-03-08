import { RecommendationCard } from "@/components/RecommendationCard";
import { AgentTimeline } from "@/components/AgentTimeline";
import { AgentChat } from "@/components/AgentChat";
import { StatusBadge } from "@/components/StatusBadge";
import { excursions, agentRecommendations, portDisruptionTimeline, shipInfo, guests } from "@/data/mockData";
import { CloudRain, MapPin, Users, DollarSign, AlertTriangle, Calendar } from "lucide-react";

const PortDisruptionAgent = () => {
  const recs = agentRecommendations.filter(r => r.agentType === "port-disruption");

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Port & Excursion Disruption Agent</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Monitor itinerary disruptions, assess impact, and coordinate rebooking and communications</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left - Itinerary & Weather */}
        <div className="space-y-4">
          {/* Weather Alert */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <CloudRain className="h-4 w-4 text-destructive" />
              <h2 className="text-sm font-semibold text-destructive">Active Weather Advisory</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              NOAA Maritime Forecast: Santorini area — wind gusts 35-40 knots expected March 16, 06:00-18:00 local time. Tendering operations likely unsafe. Probability of port cancellation: <strong className="text-foreground">78%</strong>.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground">Wind Speed</span>
                <p className="font-medium text-destructive">35-40 knots</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground">Sea State</span>
                <p className="font-medium text-warning">6-8 ft swells</p>
              </div>
            </div>
          </div>

          {/* Itinerary Status */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Itinerary Status
            </h2>
            <div className="space-y-2 text-xs">
              {[
                { port: "Barcelona", date: "Mar 12", status: "completed" as const },
                { port: "Marseille", date: "Mar 13", status: "completed" as const },
                { port: "Rome (Civitavecchia)", date: "Mar 14", status: "completed" as const },
                { port: "At Sea", date: "Mar 15", status: "normal" as const },
                { port: "Santorini", date: "Mar 16", status: "disrupted" as const },
                { port: "Mykonos", date: "Mar 17", status: "scheduled" as const },
                { port: "Rhodes", date: "Mar 18", status: "scheduled" as const },
              ].map((stop) => (
                <div key={stop.port} className="flex items-center justify-between rounded bg-muted p-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <span className="text-foreground">{stop.port}</span>
                    <span className="text-muted-foreground">{stop.date}</span>
                  </div>
                  <StatusBadge status={stop.status === "completed" ? "executed" : stop.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Impact Summary */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Impact Summary</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Guests Affected</span>
                <p className="font-medium text-foreground">142</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Revenue at Risk</span>
                <p className="font-medium text-destructive">$18,500</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground">Excursions Impacted</span>
                <p className="font-medium text-foreground">5</p>
              </div>
              <div className="rounded bg-muted p-2">
                <span className="text-muted-foreground">Platinum/Gold Guests</span>
                <p className="font-medium text-warning">14</p>
              </div>
            </div>
          </div>
        </div>

        {/* Center - Excursions & Recommendations */}
        <div className="space-y-4">
          {/* Affected Excursions */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Excursion Status
            </h2>
            <div className="space-y-2">
              {excursions.map(exc => (
                <div key={exc.id} className="rounded border border-border bg-muted p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-foreground">{exc.name}</span>
                    <StatusBadge status={exc.status} />
                  </div>
                  <div className="flex flex-wrap gap-3 text-muted-foreground mt-1">
                    <span>{exc.port}</span>
                    <span>{exc.date} at {exc.time}</span>
                    <span>{exc.booked}/{exc.capacity} booked</span>
                    <span>${exc.pricePerPerson}/pp</span>
                  </div>
                  <p className="text-muted-foreground mt-1">Vendor: {exc.vendor}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <h2 className="text-sm font-semibold text-foreground">Agent Recommendations ({recs.length})</h2>
          {recs.map(rec => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>

        {/* Right - Timeline & Demo */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Activity Timeline</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <AgentTimeline events={portDisruptionTimeline} />
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Demo Scenario</h3>
            <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
              <p><strong className="text-foreground">Trigger:</strong> NOAA maritime weather advisory for Santorini — 35-40 knot winds forecast for March 16.</p>
              <p><strong className="text-foreground">Analysis:</strong> Agent identified 142 affected guests across 5 excursions, mapped 14 high-value guests, calculated $18,500 revenue exposure, and assessed rebooking alternatives.</p>
              <p><strong className="text-foreground">Recommendation:</strong> Pre-notify guests proactively, offer Mykonos alternatives at no cost, activate sea-day programming, and auto-refund cancelled excursions.</p>
              <p><strong className="text-foreground">Outcome:</strong> 89% of affected guests rebooked. Net satisfaction score maintained. Revenue recovery: $15,200 of $18,500 at risk.</p>
            </div>
          </div>
        </div>
      </div>

      {/* NLP Chat Interface */}
      <AgentChat agentType="port-disruption" className="h-[520px]" />
    </div>
  );
};

export default PortDisruptionAgent;
