import { KPICard } from "@/components/KPICard";
import { PageTitle, SubsectionTitle, SectionSubtitle } from "@/components/PageHeading";
import { SatisfactionTrendsChart, RevenueProtectedChart, AgentConfidenceChart } from "@/components/DashboardCharts";
import { dashboardKPIs, shipInfo as mockShipInfo, incidents as mockIncidents } from "@/data/mockData";
import { Ship, MapPin, Users, Anchor, Cloud, Waves, ArrowRight, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useLiveDashboardData } from "@/lib/api";

function isPendingWorkerProposal(status: string | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized !== "approved" && normalized !== "executed" && normalized !== "rejected";
}

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
  const { kpisQuery, shipInfoQuery, incidentsQuery, actionProposalsQuery } = useLiveDashboardData();

  const liveShipInfo = shipInfoQuery.data ?? mockShipInfo;
  const liveIncidents = incidentsQuery.data ?? mockIncidents;
  const liveWorkerProposals = actionProposalsQuery.data ?? [];

  const activeIncidents = liveIncidents.filter(i => i.status !== "closed");
  const openOrReviewingIncidents = liveIncidents.filter(i => i.status === "open" || i.status === "reviewing");
  const highPriorityIncidents = activeIncidents.filter(i => i.severity === "critical" || i.severity === "high");
  const guestRecoveryPendingActions = liveWorkerProposals.filter((proposal) =>
    isPendingWorkerProposal(proposal.status),
  ).length;

  const baseKpis = kpisQuery.data && kpisQuery.data.length > 0 ? kpisQuery.data : dashboardKPIs;
  const liveKpis = baseKpis.map((kpi) => {
    if (kpi.label === "Guest Recovery Opportunities") {
      return { ...kpi, value: openOrReviewingIncidents.length };
    }
    return kpi;
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* KPI sidebar */}
        <aside className="flex w-full flex-col gap-2 lg:w-52 lg:shrink-0">
          {liveKpis.map((kpi) => (
            <KPICard key={kpi.label} kpi={kpi} compact />
          ))}
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <PageTitle>Customer Satisfaction Dashboard</PageTitle>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Cloud className="h-3.5 w-3.5" />{liveShipInfo.weatherCondition}</span>
              <span className="flex items-center gap-1"><Waves className="h-3.5 w-3.5" />{liveShipInfo.seaState}</span>
            </div>
          </div>

          {/* Ship Status Bar */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div className="flex items-center gap-2"><Ship className="h-4 w-4 text-primary" /><span className="font-medium text-foreground">{liveShipInfo.name}</span></div>
              <div className="flex items-center gap-2"><Anchor className="h-4 w-4 text-[hsl(185_70%_35%)]" /><span className="text-[hsl(185_70%_35%)] font-semibold">{liveShipInfo.currentVoyage}</span></div>
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[hsl(185_70%_35%)]" /><span className="text-[hsl(185_70%_35%)] font-semibold">{liveShipInfo.currentLocation}</span></div>
              <div className="flex items-center gap-2"><Users className="h-4 w-4 text-[hsl(185_70%_35%)]" /><span className="text-[hsl(185_70%_35%)] font-semibold">{liveShipInfo.passengers.toLocaleString()} guests · {liveShipInfo.crew.toLocaleString()} crew</span></div>
              <div className="text-[hsl(185_70%_35%)] font-semibold">Day {liveShipInfo.voyageDay}/{liveShipInfo.totalDays}</div>
              <div className="flex items-center gap-1 text-[hsl(185_70%_35%)] font-semibold">Next: {liveShipInfo.nextPort} <span className="text-[hsl(185_70%_35%)] font-semibold">ETA {new Date(liveShipInfo.nextPortETA).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span></div>
            </div>
          </div>

          {/* Guest Recovery — merged entry + snapshot */}
          <Link
            to="/guest-recovery"
            className="group block rounded-lg border border-destructive/30 bg-card p-4 transition-all hover:glow-primary hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <UserCheck className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SubsectionTitle>Guest Recovery Agent</SubsectionTitle>
                    {activeIncidents.length > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                        {activeIncidents.length}
                      </span>
                    )}
                  </div>
                  <SectionSubtitle size="sm" className="mt-1">
                    {openOrReviewingIncidents.length} open or in review · {guestRecoveryPendingActions} pending recovery actions
                  </SectionSubtitle>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
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
                <span className="text-muted-foreground">Pending Proposals</span>
                <p className="mt-1 text-lg font-semibold text-foreground">{guestRecoveryPendingActions}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Open the workspace to triage guests, chat with the recovery agent, and approve proposals.
            </p>
          </Link>

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SatisfactionTrendsChart />
            <RevenueProtectedChart />
            <AgentConfidenceChart />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
