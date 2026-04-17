import { KPICard } from "@/components/KPICard";
import { StatusBadge } from "@/components/StatusBadge";
import { SatisfactionTrendsChart, RevenueProtectedChart, AgentConfidenceChart } from "@/components/DashboardCharts";
import { dashboardKPIs, shipInfo as mockShipInfo, incidents as mockIncidents, agentRecommendations as mockRecommendations, excursions as mockExcursions, venues as mockVenues } from "@/data/mockData";
import { Ship, MapPin, Users, Anchor, Cloud, Waves, AlertTriangle, ArrowRight, DollarSign, Clock, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useLiveDashboardData } from "@/lib/api";

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ COUCHBASE INTEGRATION: Dashboard Data Loading                              │
// │                                                                             │
// │ Replace static imports with live queries:                                   │
// │                                                                             │
// │ OPTION A — Couchbase Capella (via API / Edge Function):                    │
// │   const { data: kpis } = useQuery("kpis", () =>                            │
// │     fetch("/api/kpis").then(r => r.json())                                  │
// │   );                                                                        │
// │   Backend: SQL++ aggregation queries across voyageops bucket                │
// │   KPIs computed via Capella Analytics (RT-OLAP) for heavy aggregations     │
// │   Docs: https://docs.couchbase.com/cloud/analytics/index.html              │
// │                                                                             │
// │ OPTION B — Couchbase Server (via API / Edge Function):                     │
// │   Same React Query pattern; backend uses:                                   │
// │   • N1QL (SQL++) for real-time counts and aggregations                     │
// │   • Analytics Service for cross-collection KPI computation                 │
// │   • Eventing Service for pre-computed KPI documents                        │
// │   Docs: https://docs.couchbase.com/server/current/analytics/introduction.html │
// │                                                                             │
// │ Both: Consider caching KPIs in a dedicated collection with TTL             │
// │ for sub-second dashboard loads                                              │
// └─────────────────────────────────────────────────────────────────────────────┘
const Dashboard = () => {
  const { kpisQuery, shipInfoQuery, incidentsQuery, excursionsQuery, venuesQuery, recommendationsQuery } = useLiveDashboardData();

  const liveKpis = kpisQuery.data && kpisQuery.data.length > 0 ? kpisQuery.data : dashboardKPIs;
  const liveShipInfo = shipInfoQuery.data ?? mockShipInfo;
  const liveIncidents = incidentsQuery.data ?? mockIncidents;
  const liveExcursions = excursionsQuery.data ?? mockExcursions;
  const liveVenues = venuesQuery.data ?? mockVenues;
  const liveRecommendations = recommendationsQuery.data ?? mockRecommendations;

  const activeIncidents = liveIncidents.filter(i => i.status !== "closed");
  const disruptedExcursions = liveExcursions.filter(e => e.status === "disrupted" || e.status === "cancelled");
  const overloadedVenues = liveVenues.filter(v => v.status === "overloaded" || v.status === "busy");
  const portAgentPendingActions = liveRecommendations.filter(r => r.agentType === "port-disruption" && r.status !== "executed").length;
  const onboardAgentPendingActions = liveRecommendations.filter(r => r.agentType === "onboard-ops" && r.status !== "executed").length;
  const affectedExcursionGuests = disruptedExcursions.reduce((total, excursion) => total + excursion.booked, 0);
  const excursionRevenueAtRisk = disruptedExcursions.reduce((total, excursion) => total + (excursion.booked * excursion.pricePerPerson), 0);
  const impactedVenueGuests = overloadedVenues.reduce((total, venue) => total + venue.currentOccupancy, 0);
  const avgAlertWaitTime = overloadedVenues.length > 0
    ? Math.round(overloadedVenues.reduce((total, venue) => total + venue.waitTime, 0) / overloadedVenues.length)
    : 0;
  const staffingGap = overloadedVenues.reduce((total, venue) => total + Math.max(venue.optimalStaff - venue.staffCount, 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time operational intelligence for {liveShipInfo.name}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Cloud className="h-3.5 w-3.5" />{liveShipInfo.weatherCondition}</span>
          <span className="flex items-center gap-1"><Waves className="h-3.5 w-3.5" />{liveShipInfo.seaState}</span>
        </div>
      </div>

      {/* Ship Status Bar */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="flex items-center gap-2"><Ship className="h-4 w-4 text-primary" /><span className="font-medium text-foreground">{liveShipInfo.name}</span></div>
          <div className="flex items-center gap-2"><Anchor className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{liveShipInfo.currentVoyage}</span></div>
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{liveShipInfo.currentLocation}</span></div>
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{liveShipInfo.passengers.toLocaleString()} guests · {liveShipInfo.crew.toLocaleString()} crew</span></div>
          <div className="text-muted-foreground">Day {liveShipInfo.voyageDay}/{liveShipInfo.totalDays}</div>
          <div className="flex items-center gap-1 text-primary">Next: {liveShipInfo.nextPort} <span className="text-muted-foreground">ETA {new Date(liveShipInfo.nextPortETA).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span></div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {liveKpis.map((kpi) => (
          <KPICard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Agent Workspaces Quick Links */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "Guest Recovery Agent", desc: `${liveIncidents.filter(i => i.status === "open" || i.status === "reviewing").length} active incidents · ${liveRecommendations.filter(r => r.agentType === "guest-recovery" && r.status !== "executed").length} pending actions`, link: "/guest-recovery", alerts: activeIncidents.length, color: "border-destructive/30" },
          { title: "Port & Excursion Agent", desc: `${disruptedExcursions.length} disruptions · ${liveRecommendations.filter(r => r.agentType === "port-disruption" && r.status !== "executed").length} pending actions`, link: "/port-disruption", alerts: disruptedExcursions.length, color: "border-warning/30" },
          { title: "Onboard Ops Agent", desc: `${overloadedVenues.length} venue alerts · ${liveRecommendations.filter(r => r.agentType === "onboard-ops" && r.status !== "executed").length} pending actions`, link: "/onboard-ops", alerts: overloadedVenues.length, color: "border-info/30" },
        ].map((agent) => (
          <Link key={agent.title} to={agent.link} className={`group flex items-center justify-between rounded-lg border bg-card p-4 transition-all hover:glow-primary hover:border-primary/40 ${agent.color}`}>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{agent.title}</h3>
                {agent.alerts > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">{agent.alerts}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{agent.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SatisfactionTrendsChart />
        <RevenueProtectedChart />
        <AgentConfidenceChart />
      </div>

      {/* Active Alerts & Agent Stats */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active Incidents */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Active Incidents ({activeIncidents.length})
          </h2>
          <div className="space-y-2">
            {activeIncidents.map((inc) => (
              <div key={inc.id} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{inc.id}</span>
                    <StatusBadge status={inc.severity} />
                    <StatusBadge status={inc.status} />
                  </div>
                  <p className="mt-1 text-sm text-foreground truncate">{inc.type}: {inc.category}</p>
                  <p className="text-xs text-muted-foreground truncate">{inc.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Stats */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Agent Operations Snapshot</h2>
          <div className="space-y-3">
            <Link to="/port-disruption" className="block rounded-lg border border-warning/30 bg-card p-4 transition-colors hover:border-warning/50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Port & Excursions Agent</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Live disruption exposure based on current mock excursion records.</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-muted p-3">
                  <span className="text-muted-foreground">Disrupted Excursions</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{disruptedExcursions.length}</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" />Guests Impacted</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{affectedExcursionGuests}</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="flex items-center gap-1 text-muted-foreground"><DollarSign className="h-3 w-3" />Revenue At Risk</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">${excursionRevenueAtRisk.toLocaleString()}</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="text-muted-foreground">Pending Actions</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{portAgentPendingActions}</p>
                </div>
              </div>
            </Link>

            <Link to="/onboard-ops" className="block rounded-lg border border-info/30 bg-card p-4 transition-colors hover:border-info/50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Onboard Ops Agent</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Capacity and staffing pressure derived from the current venue mock data.</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-muted p-3">
                  <span className="text-muted-foreground">Venue Alerts</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{overloadedVenues.length}</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" />Guests In Alerted Venues</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{impactedVenueGuests}</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" />Avg Wait Time</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{avgAlertWaitTime} min</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="flex items-center gap-1 text-muted-foreground"><TrendingUp className="h-3 w-3" />Staffing Gap</span>
                  <p className="mt-1 text-lg font-semibold text-foreground">{staffingGap}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{onboardAgentPendingActions} pending ops recommendations awaiting execution.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
