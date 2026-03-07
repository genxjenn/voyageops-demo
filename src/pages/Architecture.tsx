import { Database, Server, Brain, Zap, Search, Code2, Layers, ArrowRight } from "lucide-react";

const Architecture = () => {
  const layers = [
    {
      title: "Data Layer — Couchbase",
      icon: Database,
      color: "text-primary border-primary/30",
      current: "Mock JSON data in TypeScript modules",
      future: [
        "Couchbase Capella as primary operational database",
        "JSON document model for guests, bookings, incidents, venues, excursions",
        "N1QL queries for cross-entity correlation",
        "Sub-document operations for real-time venue/staff updates",
        "XDCR for multi-region replication across fleet",
      ],
      documents: ["Guest Profile", "Booking", "Incident", "Venue State", "Excursion", "Agent Recommendation", "Audit Log"],
    },
    {
      title: "Event & Stream Processing",
      icon: Zap,
      color: "text-warning border-warning/30",
      current: "Simulated alerts and triggers in mock data",
      future: [
        "Couchbase Eventing for real-time document change detection",
        "Kafka/Pulsar for cross-system event streaming",
        "Trigger-based agent activation (capacity thresholds, weather alerts, complaint logging)",
        "CDC (Change Data Capture) for audit trail generation",
      ],
      documents: ["Capacity Threshold Event", "Weather Advisory", "Complaint Filed", "Maintenance Alert"],
    },
    {
      title: "AI / Agent Orchestration",
      icon: Brain,
      color: "text-success border-success/30",
      current: "Pre-computed recommendations with confidence scores",
      future: [
        "LLM-based reasoning (GPT-4, Claude) for natural language analysis",
        "LangChain/LangGraph agent orchestration",
        "RAG pipeline using Couchbase Vector Search for semantic retrieval",
        "Multi-step reasoning chains with data retrieval tools",
        "Human-in-the-loop approval workflows",
      ],
      documents: ["Agent Prompt Template", "Reasoning Chain", "Tool Call Log", "Approval Record"],
    },
    {
      title: "Semantic / Vector Search",
      icon: Search,
      color: "text-info border-info/30",
      current: "Keyword-based data lookups in mock data",
      future: [
        "Couchbase Vector Search for semantic similarity",
        "Guest preference embeddings for personalized recovery",
        "Incident pattern matching across voyage history",
        "Natural language queries over operational data",
      ],
      documents: ["Guest Embedding", "Incident Embedding", "Preference Vector"],
    },
    {
      title: "Application Layer",
      icon: Layers,
      color: "text-foreground border-border",
      current: "React SPA with mock data, Lovable-hosted",
      future: [
        "React frontend (current) with real-time subscriptions",
        "API gateway for agent orchestration endpoints",
        "WebSocket connections for live dashboard updates",
        "Role-based access control for different operational roles",
        "Mobile-responsive for bridge and field team use",
      ],
      documents: ["User Session", "Role Assignment", "Dashboard Config"],
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Technical Architecture</h1>
        <p className="text-sm text-muted-foreground mt-0.5">How VoyageOps AI maps to a production architecture with Couchbase, event streams, and LLM-based agent reasoning</p>
      </div>

      {/* Architecture Overview */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
        <h2 className="text-sm font-semibold text-primary mb-2">Architecture Overview</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          VoyageOps AI is designed as a modular, event-driven operations platform. The current MVP demonstrates the complete user experience with mock data. Each layer below shows what is mocked today and how it maps to production services. The data model uses JSON documents designed for Couchbase's document model, with entities linked by ID references that support N1QL joins and sub-document operations.
        </p>
      </div>

      {/* Architecture Layers */}
      <div className="space-y-4">
        {layers.map((layer) => (
          <div key={layer.title} className={`rounded-lg border bg-card p-5 ${layer.color.split(" ")[1]}`}>
            <div className="flex items-center gap-2 mb-3">
              <layer.icon className={`h-5 w-5 ${layer.color.split(" ")[0]}`} />
              <h2 className="text-sm font-semibold text-foreground">{layer.title}</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Current (MVP)</p>
                <div className="rounded bg-muted p-3">
                  <p className="text-xs text-foreground">{layer.current}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Production Target</p>
                <ul className="space-y-1">
                  {layer.future.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Key Documents / Entities</p>
              <div className="flex flex-wrap gap-1.5">
                {layer.documents.map(d => (
                  <span key={d} className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground flex items-center gap-1">
                    <Code2 className="h-3 w-3" />{d}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Couchbase Fit */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">Why Couchbase for Cruise Operations?</h2>
        <div className="grid gap-3 md:grid-cols-2 text-xs text-muted-foreground">
          {[
            { title: "JSON Document Model", desc: "Cruise operational data is naturally hierarchical — guest profiles with nested preferences, bookings with line items, venues with real-time state. Couchbase's document model maps directly." },
            { title: "Sub-millisecond Reads", desc: "Real-time dashboards need instant access to venue capacity, staffing levels, and guest profiles. Couchbase's memory-first architecture delivers consistent low-latency reads." },
            { title: "Offline-First Capable", desc: "Ships operate in limited connectivity zones. Couchbase Mobile + Sync Gateway enables offline-capable operations with automatic conflict resolution when connectivity resumes." },
            { title: "Vector Search", desc: "Semantic search over guest preferences, incident patterns, and operational history enables AI agents to find relevant context without exact keyword matches." },
            { title: "Eventing", desc: "Built-in eventing triggers agent analysis when documents change — a new incident creates a recovery opportunity, a venue sensor update triggers capacity alerts." },
            { title: "Multi-Cluster Replication", desc: "XDCR enables real-time data sync between ship-side clusters and shore-side analytics, supporting fleet-wide operational intelligence." },
          ].map(item => (
            <div key={item.title} className="rounded bg-muted p-3">
              <p className="font-medium text-foreground mb-1">{item.title}</p>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Architecture;
