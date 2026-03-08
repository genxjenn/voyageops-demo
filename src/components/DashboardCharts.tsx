import {
  AreaChart, Area, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const satisfactionData = [
  { day: "Day 1", overall: 4.5, dining: 4.3, entertainment: 4.6, cabin: 4.7 },
  { day: "Day 2", overall: 4.4, dining: 4.1, entertainment: 4.5, cabin: 4.6 },
  { day: "Day 3", overall: 4.3, dining: 3.8, entertainment: 4.7, cabin: 4.5 },
  { day: "Day 4", overall: 4.2, dining: 3.5, entertainment: 4.4, cabin: 4.3 },
  { day: "Day 5", overall: 4.0, dining: 3.2, entertainment: 4.5, cabin: 4.4 },
  { day: "Day 6", overall: 3.8, dining: 3.0, entertainment: 4.3, cabin: 4.2 },
  { day: "Day 7", overall: 4.1, dining: 3.6, entertainment: 4.6, cabin: 4.5 },
  { day: "Day 8", overall: 4.3, dining: 4.0, entertainment: 4.7, cabin: 4.6 },
  { day: "Day 9", overall: 4.4, dining: 4.2, entertainment: 4.5, cabin: 4.6 },
  { day: "Day 10", overall: 4.5, dining: 4.4, entertainment: 4.6, cabin: 4.7 },
];

const revenueData = [
  { day: "Day 1", protected: 0, atRisk: 12000 },
  { day: "Day 2", protected: 8500, atRisk: 15000 },
  { day: "Day 3", protected: 22000, atRisk: 18500 },
  { day: "Day 4", protected: 45000, atRisk: 24000 },
  { day: "Day 5", protected: 68000, atRisk: 31000 },
  { day: "Day 6", protected: 89000, atRisk: 28000 },
  { day: "Day 7", protected: 105000, atRisk: 22000 },
  { day: "Day 8", protected: 118000, atRisk: 19500 },
  { day: "Day 9", protected: 132000, atRisk: 16000 },
  { day: "Day 10", protected: 142000, atRisk: 14000 },
];

const agentConfidenceData = [
  { metric: "Data Quality", guestRecovery: 94, portDisruption: 87, onboardOps: 92 },
  { metric: "Prediction Accuracy", guestRecovery: 91, portDisruption: 83, onboardOps: 88 },
  { metric: "Action Relevance", guestRecovery: 96, portDisruption: 90, onboardOps: 85 },
  { metric: "Response Time", guestRecovery: 88, portDisruption: 92, onboardOps: 95 },
  { metric: "Outcome Success", guestRecovery: 89, portDisruption: 78, onboardOps: 91 },
  { metric: "Coverage", guestRecovery: 92, portDisruption: 85, onboardOps: 93 },
];

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(0 0% 100%)",
    border: "1px solid hsl(215 15% 90%)",
    borderRadius: "8px",
    fontSize: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  },
  labelStyle: { fontWeight: 600, color: "hsl(215 15% 18%)" },
};

export function SatisfactionTrendsChart() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-foreground mb-1">Guest Satisfaction Trends</h3>
      <p className="text-xs text-muted-foreground mb-4">Daily satisfaction scores across key areas (1–5 scale)</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={satisfactionData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradOverall" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(185 70% 45%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(185 70% 45%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDining" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(0 72% 55%)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="hsl(0 72% 55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 15% 90%)" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(215 15% 45%)" }} />
            <YAxis domain={[2.5, 5]} tick={{ fontSize: 11, fill: "hsl(215 15% 45%)" }} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Area type="monotone" dataKey="overall" name="Overall" stroke="hsl(185 70% 45%)" fill="url(#gradOverall)" strokeWidth={2.5} dot={false} />
            <Area type="monotone" dataKey="dining" name="Dining" stroke="hsl(0 72% 55%)" fill="url(#gradDining)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            <Area type="monotone" dataKey="entertainment" name="Entertainment" stroke="hsl(280 60% 55%)" fill="transparent" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="cabin" name="Cabin" stroke="hsl(152 60% 42%)" fill="transparent" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RevenueProtectedChart() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
      <h3 className="text-sm font-semibold text-foreground mb-1">Revenue Protection</h3>
      <p className="text-xs text-muted-foreground mb-4">Cumulative revenue protected vs. at-risk by AI agents</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={revenueData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 15% 90%)" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(215 15% 45%)" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(215 15% 45%)" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip {...tooltipStyle} formatter={(value: number) => [`$${value.toLocaleString()}`, undefined]} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="protected" name="Protected" fill="hsl(185 70% 45%)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="atRisk" name="At Risk" fill="hsl(38 92% 50%)" radius={[3, 3, 0, 0]} opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AgentConfidenceChart() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
      <h3 className="text-sm font-semibold text-foreground mb-1">Agent Confidence Scores</h3>
      <p className="text-xs text-muted-foreground mb-4">Performance metrics across all three AI agents</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={agentConfidenceData}>
            <PolarGrid stroke="hsl(215 15% 88%)" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "hsl(215 15% 45%)" }} />
            <PolarRadiusAxis angle={30} domain={[60, 100]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Radar name="Guest Recovery" dataKey="guestRecovery" stroke="hsl(185 70% 45%)" fill="hsl(185 70% 45%)" fillOpacity={0.15} strokeWidth={2} />
            <Radar name="Port Disruption" dataKey="portDisruption" stroke="hsl(38 92% 50%)" fill="hsl(38 92% 50%)" fillOpacity={0.1} strokeWidth={2} />
            <Radar name="Onboard Ops" dataKey="onboardOps" stroke="hsl(152 60% 42%)" fill="hsl(152 60% 42%)" fillOpacity={0.1} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
