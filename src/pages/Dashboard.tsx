import { KPICard } from "@/components/KPICard";
import { StatusBadge } from "@/components/StatusBadge";
import { RecommendationCard } from "@/components/RecommendationCard";
import { SatisfactionTrendsChart, RevenueProtectedChart, AgentConfidenceChart } from "@/components/DashboardCharts";
import { dashboardKPIs, shipInfo, incidents, agentRecommendations, excursions, venues } from "@/data/mockData";
import { Ship, MapPin, Users, Anchor, Cloud, Waves, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Dashboard = () => {
  const pendingRecs = agentRecommendations.filter(r => r.status === "pending" || r.status === "reviewing");
  const activeIncidents = incidents.filter(i => i.status !== "closed");
  const disruptedExcursions = excursions.filter(e => e.status === "disrupted" || e.status === "cancelled");
  const overloadedVenues = venues.filter(v => v.status === "overloaded" || v.status === "busy");

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time operational intelligence for {shipInfo.name}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Cloud className="h-3.5 w-3.5" />{shipInfo.weatherCondition}</span>
          <span className="flex items-center gap-1"><Waves className="h-3.5 w-3.5" />{shipInfo.seaState}</span>
        </div>
      </div>

      {/* Ship Status Bar */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="flex items-center gap-2"><Ship className="h-4 w-4 text-primary" /><span className="font-medium text-foreground">{shipInfo.name}</span></div>
          <div className="flex items-center gap-2"><Anchor className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{shipInfo.currentVoyage}</span></div>
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{shipInfo.currentLocation}</span></div>
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{shipInfo.passengers.toLocaleString()} guests · {shipInfo.crew.toLocaleString()} crew</span></div>
          <div className="text-muted-foreground">Day {shipInfo.voyageDay}/{shipInfo.totalDays}</div>
          <div className="flex items-center gap-1 text-primary">Next: {shipInfo.nextPort} <span className="text-muted-foreground">ETA {new Date(shipInfo.nextPortETA).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span></div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {dashboardKPIs.map((kpi) => (
          <KPICard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Agent Workspaces Quick Links */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "Guest Recovery Agent", desc: `${incidents.filter(i => i.status === "open" || i.status === "reviewing").length} active incidents · ${agentRecommendations.filter(r => r.agentType === "guest-recovery" && r.status !== "executed").length} pending actions`, link: "/guest-recovery", alerts: activeIncidents.length, color: "border-destructive/30" },
          { title: "Port & Excursion Agent", desc: `${disruptedExcursions.length} disruptions · ${agentRecommendations.filter(r => r.agentType === "port-disruption" && r.status !== "executed").length} pending actions`, link: "/port-disruption", alerts: disruptedExcursions.length, color: "border-warning/30" },
          { title: "Onboard Ops Agent", desc: `${overloadedVenues.length} venue alerts · ${agentRecommendations.filter(r => r.agentType === "onboard-ops" && r.status !== "executed").length} pending actions`, link: "/onboard-ops", alerts: overloadedVenues.length, color: "border-info/30" },
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

      {/* Active Alerts & Pending Recommendations */}
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

        {/* Pending Recommendations */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Pending Agent Recommendations ({pendingRecs.length})</h2>
          <div className="space-y-3">
            {pendingRecs.slice(0, 3).map((rec) => (
              <RecommendationCard key={rec.id} recommendation={rec} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
