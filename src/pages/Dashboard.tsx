import { KPICard } from "@/components/KPICard";
import { StatusBadge } from "@/components/StatusBadge";
import { SatisfactionTrendsChart, RevenueProtectedChart, AgentConfidenceChart } from "@/components/DashboardCharts";
import { dashboardKPIs, shipInfo as mockShipInfo, incidents as mockIncidents, agentRecommendations as mockRecommendations } from "@/data/mockData";
import { Ship, MapPin, Users, Anchor, Cloud, Waves, AlertTriangle, ArrowRight, UserCheck } from "lucide-react";
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

function dashboardIncidentHeadingId(inc: { id: string; incidentId?: string }) {
  const fromApi = inc.incidentId?.trim();
  return fromApi || inc.id;
}

const Dashboard = () => {
  const { kpisQuery, shipInfoQuery, incidentsQuery, recommendationsQuery } = useLiveDashboardData();

  const liveKpis = kpisQuery.data && kpisQuery.data.length > 0 ? kpisQuery.data : dashboardKPIs;
  const liveShipInfo = shipInfoQuery.data ?? mockShipInfo;
  const liveIncidents = incidentsQuery.data ?? mockIncidents;
  const liveRecommendations = (recommendationsQuery.data ?? mockRecommendations).filter(
    (r) => r.agentType === "guest-recovery",
  );

  const activeIncidents = liveIncidents.filter(i => i.status !== "closed");
  const openOrReviewingIncidents = liveIncidents.filter(i => i.status === "open" || i.status === "reviewing");
  const highPriorityIncidents = activeIncidents.filter(i => i.severity === "critical" || i.severity === "high");
  const guestRecoveryPendingActions = liveRecommendations.filter(
    r => r.agentType === "guest-recovery" && r.status !== "executed",
  ).length;

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

      {/* Guest Recovery workspace */}
      <Link
        to="/guest-recovery"
        className="group flex items-center justify-between rounded-lg border border-destructive/30 bg-card p-4 transition-all hover:glow-primary hover:border-primary/40"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <UserCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Guest Recovery Agent</h3>
              {activeIncidents.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {activeIncidents.length}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {openOrReviewingIncidents.length} open or in review · {guestRecoveryPendingActions} pending recovery actions
            </p>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
      </Link>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SatisfactionTrendsChart />
        <RevenueProtectedChart />
        <AgentConfidenceChart />
      </div>

      {/* Active incidents & recovery snapshot */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Active Incidents ({activeIncidents.length})
          </h2>
          <div className="space-y-2">
            {activeIncidents.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No active incidents.</p>
            ) : (
              activeIncidents.map((inc) => {
                const headingId = dashboardIncidentHeadingId(inc);
                return (
                  <div key={headingId} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={inc.severity} />
                        <StatusBadge status={inc.status} />
                      </div>
                      <p className="mt-1 text-sm text-foreground truncate">
                        {inc.type}: {inc.category}: {headingId}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{inc.description}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Guest Recovery Snapshot</h2>
          <Link
            to="/guest-recovery"
            className="block rounded-lg border border-primary/30 bg-card p-4 transition-colors hover:border-primary/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Recovery queue & approvals</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Live incident prioritization, AI recovery plans, and action proposals.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-muted p-3">
                <span className="text-muted-foreground">Open / In Review</span>
                <p className="mt-1 text-lg font-semibold text-foreground">{openOrReviewingIncidents.length}</p>
              </div>
              <div className="rounded bg-muted p-3">
                <span className="text-muted-foreground">High Priority</span>
                <p className="mt-1 text-lg font-semibold text-foreground">{highPriorityIncidents.length}</p>
              </div>
              <div className="rounded bg-muted p-3">
                <span className="text-muted-foreground">Active Incidents</span>
                <p className="mt-1 text-lg font-semibold text-foreground">{activeIncidents.length}</p>
              </div>
              <div className="rounded bg-muted p-3">
                <span className="text-muted-foreground">Pending Actions</span>
                <p className="mt-1 text-lg font-semibold text-foreground">{guestRecoveryPendingActions}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Open the workspace to triage guests, chat with the recovery agent, and approve proposals.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
