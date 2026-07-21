import { PageTitle, SectionTitle, SectionSubtitle } from "@/components/PageHeading";
import { Database, Brain, Zap, Search, Code2, Layers, CheckCircle2, Circle } from "lucide-react";

const Architecture = () => {
  const layers = [
    {
      title: "Data Layer — Couchbase Capella",
      icon: Database,
      color: "text-primary border-primary/30",
      implementation: [
        "Couchbase Capella cluster (`voyageops` bucket) is the live operational store — no mock data in the running app",
        "JSON documents across guests, agent, agent_catalog, agent_activity, intelligence, operations, excursions, and eventing scopes",
        "SQL++ (N1QL) joins guests ↔ incidents ↔ bookings and resolves playbook/action/policy context for every agent run",
        "GSI vector indexes on incident embeddings for semantic chat retrieval",
      ],
      documents: ["Guest", "Booking", "Incident", "Venue", "Excursion", "Action Proposal", "Agent Run"],
    },
    {
      title: "Event Processing — Capella Eventing",
      icon: Zap,
      color: "text-warning border-warning/30",
      implementation: [
        "An OnUpdate Eventing handler on `voyageops.guests.incidents` fires when an incident's status transitions to open",
        "Deterministic key (`agent_runs::guest-recovery::{incidentId}::v{openVersion}`) makes re-saves of the same incident version idempotent — no duplicate runs",
        "Creates a pending `agent_runs` document that the Python worker polls for on a fixed interval",
      ],
      documents: ["Incident (open)", "Agent Run (pending)"],
    },
    {
      title: "AI / Agent Orchestration",
      icon: Brain,
      color: "text-success border-success/30",
      implementation: [
        "Python worker (`guest_recovery_worker.py`) polls pending runs, resolves incident + guest + playbook + eligible actions + policy rules, and calls OpenAI chat completions for a structured JSON recommendation",
        "Couchbase Agent Catalog (`agentc`) versions the worker's system prompt and its 4 tools (`analyze_guest_sentiment`, `create_incident_embedding`, `find_playbook_id`, `fetch_actions_and_policies`); toggled via `GUEST_RECOVERY_USE_AGENTC`",
        "Every run is traced end-to-end with an `agentc.Span` — tool calls, LLM prompts/completions, and span timing are visible in Capella's Agent Tracer",
        "A coverage-gap path drafts new playbook/action/policy artifacts when no eligible catalog action exists, instead of forcing a bad recommendation",
        "Human-in-the-loop: an operator approves via `POST /api/action-proposals/:id/approve` before anything executes",
      ],
      documents: ["Agent Run", "Action Proposal", "Agent Catalog Prompt", "Agent Catalog Tool", "Activity Span Log"],
    },
    {
      title: "Semantic Search & AI Functions",
      icon: Search,
      color: "text-info border-info/30",
      implementation: [
        "OpenAI `text-embedding-3-small` embeddings for incidents, action catalog entries, and playbooks (1536-dim, L2 similarity)",
        "Chat retrieval (`POST /api/agent-query`) runs `APPROX_VECTOR_DISTANCE` across incident GSI vector indexes in parallel, falling back to in-memory cosine similarity if no index is available",
        "Worker playbook matching tries an FTS vector index first, then falls back to a GSI `APPROX_VECTOR_DISTANCE` query",
        "Couchbase's native SQL++ AI Function (`default:ai_sentiment`) analyzes each incident description and persists the result as `guestSentiment`, feeding the LLM's recommendation prompt as extra signal",
      ],
      documents: ["Incident Embedding", "Playbook Embedding", "Action Catalog Embedding", "Guest Sentiment"],
    },
    {
      title: "Application Layer",
      icon: Layers,
      color: "text-foreground border-border",
      implementation: [
        "React 18 + TypeScript + Vite SPA, Express API (`src/api/server.ts`), Vite proxies `/api/*` to the API in dev",
        "TanStack React Query polls KPIs, incidents, and proposals every 10s for a live dashboard — no WebSockets yet",
        "Guest Recovery workspace: ranked incident queue, guest profile + approval queue, chat-focused recovery plan, live worker activity log via SSE",
        "No authentication — demo mode; Couchbase and OpenAI credentials live server-side only and are never sent to the client",
      ],
      documents: ["Dashboard KPI", "Prioritized Incident", "Worker Log Stream", "Chat Session"],
    },
  ];

  const whyCouchbase = [
    { title: "JSON Document Model", desc: "Cruise operational data is naturally hierarchical — guest profiles, bookings with line items, venues with real-time state. Couchbase's document model maps directly, with no ORM translation layer." },
    { title: "Sub-millisecond Reads", desc: "The live dashboard and Guest Recovery workspace poll Couchbase every 10 seconds for KPIs, incidents, and proposals — Couchbase's memory-first architecture keeps that path fast." },
    { title: "Vector Search", desc: "GSI and FTS vector indexes power semantic retrieval today — incident chat search, playbook matching, and action catalog lookups all run against embedded data, not keyword matches." },
    { title: "Eventing", desc: "The OnUpdate handler on incidents is what actually kicks off an agent run — no polling loop watches the guests scope; Eventing does that work inside the cluster." },
  ];

  const notYetImplemented = [
    "Outcomes write-back — `agent.outcomes` has a vector index provisioned but no code path writes to it yet; approval stops at an `action_executions` stub",
    "Full execution + governance workflow for approving generated draft playbook/action/policy artifacts (coverage-gap path)",
    "Authentication and role-based access control (currently demo mode, no auth)",
    "WebSocket-based live updates (dashboard currently uses 10s polling)",
    "Multi-region XDCR replication and multi-ship fleet aggregation",
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div>
        <PageTitle>Technical Architecture</PageTitle>
        <SectionSubtitle className="mt-1">
          How VoyageOps AI is built on Couchbase Capella, Eventing, and LLM-based agent reasoning
        </SectionSubtitle>
      </div>

      {/* Architecture Overview */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
        <SectionTitle className="mb-2">Architecture Overview</SectionTitle>
        <SectionSubtitle size="sm" className="leading-relaxed">
          VoyageOps AI is a working, event-driven operations platform, not a mock-data prototype. The Guest Recovery Agent runs end-to-end today: Capella Eventing detects a new open incident, a Python worker resolves guest/playbook/policy context and calls an LLM for a recommendation, every step is traced through Couchbase Agent Catalog, and an operator approves the proposal before anything happens. Each layer below reflects what is actually running.
        </SectionSubtitle>
      </div>

      {/* Architecture Layers */}
      <div className="space-y-4">
        {layers.map((layer) => (
          <div key={layer.title} className={`rounded-lg border bg-card p-5 ${layer.color.split(" ")[1]}`}>
            <div className="flex items-center gap-2 mb-3">
              <layer.icon className={`h-5 w-5 ${layer.color.split(" ")[0]}`} />
              <SectionTitle>{layer.title}</SectionTitle>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Implemented</p>
              <ul className="space-y-1">
                {layer.implementation.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-success" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
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
        <SectionTitle className="mb-3">Why Couchbase Here</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 text-xs text-muted-foreground">
          {whyCouchbase.map(item => (
            <div key={item.title} className="rounded bg-muted p-3">
              <p className="font-medium text-foreground mb-1">{item.title}</p>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Roadmap / Gaps */}
      <div className="rounded-lg border border-border bg-card p-5">
        <SectionTitle className="mb-3">Not Yet Implemented</SectionTitle>
        <ul className="space-y-1.5">
          {notYetImplemented.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Circle className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Architecture;
