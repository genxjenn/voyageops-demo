# VoyageOps AI — Architecture & Design Specification

> **Version:** 1.1 · **Last Updated:** March 2026  
> **Platform:** Acme Cruise Line · MS Acme Voyager  
> **Status:** MVP (Phase 1 mock data for Port & Excusion AND Onboard Ops, Phase 2 — Couchbase cluster Data for Guests & Incident Initiation ) with production architecture defined.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Application Architecture](#3-application-architecture)
4. [Agent System Design](#4-agent-system-design)
5. [Data Model & Schema](#5-data-model--schema)
6. [Agent Runtime & Eventing](#6-agent-runtime--eventing)
7. [Vector Retrieval Pipeline](#7-vector-retrieval-pipeline)
8. [Component Architecture](#8-component-architecture)
9. [Design System](#9-design-system)
10. [Routing & Navigation](#10-routing--navigation)
11. [State Management](#11-state-management)
12. [Chat & NLP Interface](#12-chat--nlp-interface)
13. [Guided Demo System](#13-guided-demo-system)
14. [Production Roadmap](#14-production-roadmap)
15. [Deployment & Infrastructure](#15-deployment--infrastructure)
16. [Security Considerations](#16-security-considerations)
17. [Appendix: File Inventory](#17-appendix-file-inventory)

---

## 1. Executive Summary

VoyageOps AI is an AI-powered operational intelligence platform for cruise line operations. It demonstrates how operational AI agents can ingest transactional and operational data to detect issues, reason about context, and recommend actions — with human-in-the-loop approval workflows.

### Core Value Proposition

| Metric | Before (Manual) | After (AI Agents) |
|---|---|---|
| Incident detection | Reactive (guest complaint) | Proactive (sensor + pattern) |
| Recovery planning | 2-4 hours | < 3 minutes |
| Revenue at risk | $142K+ unprotected | 89% recovery rate |
| Guest satisfaction recovery | ~60% | 89%+ |
| Staff rebalancing | Shift-level (hours) | Real-time (minutes) |

### Three AI Agents

| Agent | Domain | Trigger Examples |
|---|---|---|
| **Guest Service Recovery** | Detect service failures, correlate guest value, recommend compensation | Dining complaint + Platinum guest + high spend |
| **Port & Excursion Disruption** | Monitor weather/vendor disruptions, coordinate rebooking | NOAA advisory + tendering risk + 142 affected guests |
| **Onboard Operations Optimization** | Balance venue capacity, staffing, maintenance | 96% occupancy + 25% understaffing + growing wait time |

---

## 2. System Overview

### Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | React 18.3 + TypeScript 5.8 | UI framework with strict typing |
| **Build** | Vite 5.4 | Fast dev server and production bundler |
| **Styling** | Tailwind CSS 3.4 + CSS Variables | Utility-first with semantic design tokens |
| **Components** | shadcn/ui (Radix primitives) | Accessible, composable component library |
| **Charts** | Recharts 2.15 | Data visualization (Area, Bar, Radar) |
| **Animation** | Framer Motion 12.35 | Page transitions, guided demo, micro-interactions |
| **Markdown** | react-markdown 10.1 | Render agent responses with rich formatting |
| **Routing** | React Router 6.30 | Client-side SPA routing |
| **Date Utils** | date-fns 3.6 | Timestamp formatting in chat messages |
| **State** | React useState/useCallback | Local component state (no global store) |
| **Notifications** | Sonner 1.7 | Toast notifications for actions |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (SPA)                         │
│  ┌──────────┐  ┌──────────────────────────────────────┐ │
│  │ Sidebar  │  │           Main Content               │ │
│  │ AppLayout│  │  ┌──────────────────────────────┐    │ │
│  │          │  │  │  Page Components              │    │ │
│  │ • Dash   │  │  │  (Dashboard, GuestRecovery,   │    │ │
│  │ • Guest  │  │  │   PortDisruption, OnboardOps, │    │ │
│  │ • Port   │  │  │   Architecture)               │    │ │
│  │ • Ops    │  │  └──────────────────────────────┘    │ │
│  │ • Arch   │  │  ┌──────────────────────────────┐    │ │
│  │          │  │  │  AgentChat (NLP Interface)     │    │ │
│  │ Agent    │  │  │  • Pattern-matched responses   │    │ │
│  │ Status   │  │  │  • Streaming simulation        │    │ │
│  │ Indicators│ │  │  • Markdown rendering           │    │ │
│  └──────────┘  │  └──────────────────────────────┘    │ │
│                └──────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐   │
│  │           GuidedDemo (Overlay Panel)              │   │
│  │  • Step-by-step walkthrough                       │   │
│  │  • Fires queries into AgentChat via CustomEvent   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         ▼ (Phase 2 — Production)
┌─────────────────────────────────────────────────────────┐
│  API Gateway / Edge Functions                            │
│  ┌────────────────┐  ┌────────────────┐                 │
│  │ Couchbase       │  │ LLM / RAG      │                │
│  │ Capella DB      │  │ Pipeline       │                │
│  │ (JSON docs,     │  │ (LangChain,    │                │
│  │  Vector Search, │  │  GPT-4/Claude) │                │
│  │  Eventing)      │  │                │                │
│  └────────────────┘  └────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Application Architecture (Phase 1 → Phase 2 Transition)

### Data Model Evolution

**Phase 1 (MVP — Current):** Mock data in `src/data/mockData.ts`

**Phase 2 (Active):** Live Couchbase backend with agent lifecycle management

The frontend remains unchanged — all fetch calls route through `/api/*` proxy to backend routes.

### Entry Point & Component Tree

```
index.html → src/main.tsx → App.tsx → BrowserRouter → AppLayout → Routes
```

Frontend initialization:
1. React Query wraps all async operations (ready for remote API)
2. BrowserRouter establishes SPA routing
3. AppLayout provides persistent sidebar navigation
4. Each page component (Dashboard, GuestRecoveryAgent, etc.) dispatches API calls

### Backend Entry Point

```
npm run dev → Vite (port 5173) → /api/* proxy → src/api/server.ts → Express routes → Couchbase SDK
```

### App.tsx — Root Component

```tsx
<QueryClientProvider>          // React Query (ready for async data)
  <TooltipProvider>            // Global tooltip context
    <Toaster /> <Sonner />     // Dual notification systems
    <BrowserRouter>
      <AppLayout>              // Sidebar + main content wrapper
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/guest-recovery" element={<GuestRecoveryAgent />} />
          <Route path="/port-disruption" element={<PortDisruptionAgent />} />
          <Route path="/onboard-ops" element={<OnboardOpsAgent />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  </TooltipProvider>
</QueryClientProvider>
```

### AppLayout Component

The `AppLayout` provides a persistent sidebar navigation with:

- **Logo area** — VoyageOps AI branding with Anchor icon
- **Navigation links** — 5 routes with active state highlighting using `NavLink`
- **Agent status indicators** — 3 pulsing green dots showing agent health
- **Collapse toggle** — Sidebar collapses from 240px to 64px (icon-only mode)
- **Scrollable content area** — Main content with custom thin scrollbar

---

## 4. Agent System Design

### Agent Architecture Pattern

Each agent follows an identical structural pattern:

```
┌─────────────────────────────────────────────────┐
│                Agent Page (3-Column Grid)         │
│                                                   │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────┐│
│  │ Context      │ │ Recommen-    │ │ Timeline   ││
│  │ Panel        │ │ dations      │ │ + Demo     ││
│  │              │ │              │ │ Scenario   ││
│  │ • Entity     │ │ • Rec Cards  │ │            ││
│  │   details    │ │ • Approve/   │ │ • Chrono-  ││
│  │ • Active     │ │   Reject     │ │   logical  ││
│  │   alerts     │ │ • Confidence │ │   events   ││
│  │ • Impact     │ │ • Reasoning  │ │ • Actor    ││
│  │   summary    │ │ • Actions    │ │   labels   ││
│  └─────────────┘ └──────────────┘ └────────────┘│
│                                                   │
│  ┌───────────────────────────────────────────────┐│
│  │         AgentChat — NLP Interface (520px)      ││
│  └───────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### Guest Recovery Agent (`/guest-recovery`) — Live Vector Retrieval

**Context Panel:**
- Guest profile card (name, loyalty tier, cabin, booking, spend, sailing history, notes)
- Active incident card (ID, severity badge, status badge, timestamps)
- All incidents list with severity/status badges

**AI Chat Interface (AgentChat):**
- User query → `POST /api/agent-query` with OpenAI embedding
- Backend performs SQL++ `APPROX_VECTOR_DISTANCE` search across 3 vector indexes
- Returns ranked incidents + metadata (retrieval mode, indexes used, embedding source)
- Chat badge shows: 
  - **Vector Mode** (blue) = indexes active
  - **Indexes active** (gray) = count of live GSI vector indexes
  - **Fallback active** (warning) = in-memory cosine similarity fallback

**Agent data model (production):**
- Query triggers Capella Eventing OnUpdate → writes pending run to `agent_runs`
- Backend worker polls pending runs
- Retrieves semantically-matched actions + playbooks from vector indexes
- Assembles context, calls LLM (GPT-4/Claude via OpenAI API)
- Writes proposal to `action_proposals` → approval queue
- On approval, writes execution + outcomes for analytics

**Unique data points:** Lifetime value, churn risk, first-complaint flag, policy constraints

### Port & Excursion Disruption Agent (`/port-disruption`)

**Context Panel:**
- Active weather advisory (wind speed, sea state, cancellation probability)
- 7-day itinerary status with per-port status badges
- Impact summary (guests affected, revenue at risk, excursions impacted, high-value guests)

**Unique data points:** NOAA forecast integration, tendering risk assessment, vendor cancellation handling

### Onboard Operations Agent (`/onboard-ops`)

**Context Panel:**
- Venue utilization cards with occupancy bars (color-coded: green < 70%, yellow 70-90%, red > 90%)
- Staff gap indicators (current vs. optimal staffing)
- Wait time metrics per venue
- Maintenance flags with priority and ETA

**Unique data points:** Real-time sensor simulation, staff redeployment calculations, predictive capacity overflow

---

## 5. Data Model & Schema

All data is defined in `src/data/mockData.ts` as TypeScript interfaces with mock instances. The schema is designed to map directly to Couchbase JSON documents.

### Entity Relationship Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│    Guest     │────▶│   Booking    │     │  AgentRecommendation │
│              │     │              │     │                      │
│ id           │     │ id           │     │ id                   │
│ name         │     │ guestId ─────│──┐  │ agentType            │
│ loyaltyTier  │     │ shipName     │  │  │ title                │
│ loyaltyNumber│     │ voyageNumber │  │  │ summary              │
│ cabinNumber  │     │ departureDate│  │  │ reasoning            │
│ bookingId    │     │ cabinType    │  │  │ dataSourcesUsed[]    │
│ onboardSpend │     │ totalValue   │  │  │ confidence (0-100)   │
│ sailingHistory│    │ status       │  │  │ impact (h/m/l)       │
└──────────────┘     └──────────────┘  │  │ status               │
       │                               │  │ actions[]            │
       ▼                               │  │ relatedEntityId ─────│──▶ Guest | Excursion
┌──────────────┐                       │  │ relatedEntityType    │
│   Incident   │◀──────────────────────┘  └──────────────────────┘
│              │
│ id           │     ┌──────────────┐     ┌──────────────┐
│ guestId      │     │  Excursion   │     │    Venue     │
│ type         │     │              │     │              │
│ category     │     │ id           │     │ id           │
│ description  │     │ name         │     │ name         │
│ severity     │     │ port         │     │ type         │
│ status       │     │ date/time    │     │ deck         │
│ createdAt    │     │ capacity     │     │ capacity     │
│ updatedAt    │     │ booked       │     │ currentOccupancy│
└──────────────┘     │ pricePerPerson│    │ waitTime     │
                     │ status       │     │ staffCount   │
                     │ vendor       │     │ optimalStaff │
                     └──────────────┘     │ status       │
                                          └──────────────┘
```

### TypeScript Interfaces

| Interface | Fields | Used By |
|---|---|---|
| `Guest` | id, name, email, loyaltyTier, loyaltyNumber, cabinNumber, bookingId, onboardSpend, sailingHistory | GuestRecoveryAgent |
| `Booking` | id, guestId, shipName, voyageNumber, departureDate, returnDate, cabinType, cabinNumber, totalValue, status | (Available for expansion) |
| `Incident` | id, guestId, type, category, description, severity, status, createdAt, updatedAt | Dashboard, GuestRecoveryAgent |
| `Excursion` | id, name, port, date, time, capacity, booked, pricePerPerson, status, vendor | PortDisruptionAgent |
| `Venue` | id, name, type, deck, capacity, currentOccupancy, waitTime, staffCount, optimalStaff, status | OnboardOpsAgent |
| `AgentRecommendation` | id, agentType, title, summary, reasoning, dataSourcesUsed[], confidence, impact, status, actions[], createdAt, relatedEntityId/Type | All agent pages, Dashboard |
| `RecommendedAction` | id, label, type, estimatedValue, description | RecommendationCard |
| `TimelineEvent` | id, timestamp, type, title, description, actor | AgentTimeline |
| `OperationalKPI` | label, value, change, changeLabel, icon, trend | Dashboard KPICard |

### Status Enums

```typescript
// Incident/Recommendation workflow
"open" → "reviewing" → "approved" → "executed" → "closed"
                      → "rejected"
                      → "pending" (initial)

// Excursion lifecycle
"scheduled" → "disrupted" → "cancelled" | "rebooked"

// Venue operational state
"normal" | "busy" | "overloaded" | "maintenance"

// Severity levels
"critical" | "high" | "medium" | "low"
```

### Mock Data Inventory

| Entity | Count | Key Scenarios |
|---|---|---|
| Guests | 5 | Platinum (Margaret Chen, Rossi), Gold (Hartwell), Silver (Nakamura), Bronze (Thompson) |
| Incidents | 4 | Dining complaint, AC failure, show cancellation, lost item |
| Excursions | 4 | Santorini (disrupted), Mykonos (scheduled), Rhodes (scheduled), Crete (cancelled) |
| Venues | 8 | Fine dining, casual, buffet, bar, pool, spa, theater, kids club |
| Recommendations | 6 | 2 guest recovery, 2 port disruption, 2 onboard ops |
| Timeline Events | 12 | 5 guest recovery, 4 port disruption, 3 onboard ops |
| KPIs | 6 | Recovery opportunities, disruptions mitigated, time saved, bottlenecks, revenue, satisfaction |

---

## 6. Agent Runtime & Eventing

### Capella Eventing Trigger (OnUpdate Handler)

When a new incident is inserted or its status transitions to `open`:

1. **Source:** `voyageops.guests.incidents` collection (any document update)
2. **OnUpdate Handler:** Evaluates eligibility conditions
   - Gate: `doc.status === "open"` (only open incidents)
   - Idempotency: `doc.openVersion` versioning (re-saves of same version create zero new runs)
   - Deterministic key: `agent_runs::guest-recovery::{incidentId}::v{openVersion}`
3. **Destination Binding (dst):** `voyageops.agent.agent_runs` collection
4. **Metadata Collection:** `voyageops.eventing.sysdata` (internal Capella state)

### Agent Run Lifecycle

```
Incident created (status=open)
     ↓
  Eventing OnUpdate fires                               ← IMPLEMENTED
     ↓
  New pending agent_run created                         ← IMPLEMENTED
     ↓
  Backend worker polls agent_runs WHERE status="pending"← NOT YET IMPLEMENTED
     ↓
  Vector retrieval: actions + playbooks + policies      ← DATA READY (indexes + seed data)
     ↓
  LLM prompt assembly + chat/completions call           ← NOT YET IMPLEMENTED
     ↓
  Agent generates action_proposal (pending approval)    ← NOT YET IMPLEMENTED
     ↓
  Human approves → action_execution created             ← NOT YET IMPLEMENTED
     ↓
  Outcomes measured and recorded                        ← NOT YET IMPLEMENTED
```

### Collections in Agent Scope

| Collection | Purpose | Vector Index |
|---|---|---|
| `agent_runs` | Tracks each agent invocation | NO |
| `action_proposals` | Pending agent recommendations | NO |
| `action_executions` | Approved + executed actions | NO |
| `action_catalog` | Lookup library of recovery actions | **YES** (embedding) |
| `playbooks` | Workflow templates combining actions | **YES** (embedding) |
| `policy_rules` | Constraints & guardrails | NO |

---

## 7. Vector Retrieval Pipeline

### Embedded Data Seeding

Before agent runs can generate quality proposals, seed the retrieval collections:

```bash
npm run seed:agent
```

**Populates:**
- **action_catalog** (10 actions with OpenAI embeddings)
- **playbooks** (6 playbooks with embeddings)
- **policy_rules** (6 policy documents for constraints)

Embeddings use OpenAI `text-embedding-3-small` (1536 dims, L2 similarity).

### Vector Index Structure

Three SQL++ GSI vector indexes on the agent scope:

```sql
CREATE VECTOR INDEX voAgent_vector_action_catalog_embedding
ON voyageops.agent.action_catalog(embedding VECTOR);

CREATE VECTOR INDEX voAgent_vector_playbooks_embedding
ON voyageops.agent.playbooks(embedding VECTOR);

CREATE VECTOR INDEX voAgent_vector_outcomes_embedding
ON voyageops.agent.outcomes(embedding VECTOR);
```

All configured with: 1536 dimensions, L2 similarity, IVF,SQ8 description.

### Retrieval Flow (POST /api/agent-query)

1. **Embedding:** OpenAI or corpus fallback (token-overlap cosine similarity)
2. **SQL++ Search:** `APPROX_VECTOR_DISTANCE` across 3 collections in parallel
3. **Deduplication:** Aggregates results by docId, de-duplicates across indexes
4. **Fallback:** In-memory cosine similarity if indexes unavailable
5. **Metadata:** Returns retrieval mode, indexes used, embedding source

### Chat UI Integration

AgentChat displays retrieval status:
- **Vector Mode** badge (blue) = indexes active
- **3 indexes active** = count of live GSI vectors
- **Fallback active** warning = using in-memory similarity

---

## 8. Component Architecture

### Component Hierarchy

```
App
├── AppLayout
│   ├── Sidebar Navigation (5 NavLinks)
│   ├── Agent Status Indicators
│   └── Collapse Toggle
├── Dashboard
│   ├── KPICard (×6)
│   ├── Agent Workspace Cards (×3, linked)
│   ├── SatisfactionTrendsChart (AreaChart)
│   ├── RevenueProtectedChart (BarChart)
│   ├── AgentConfidenceChart (RadarChart)
│   ├── Active Incidents List
│   └── RecommendationCard (×3, pending)
├── GuestRecoveryAgent
│   ├── Guest Profile Card
│   ├── Active Incident Card
│   ├── All Incidents List
│   ├── RecommendationCard (×2)
│   ├── AgentTimeline (5 events)
│   ├── Demo Scenario Card
│   └── AgentChat (guest-recovery)
├── PortDisruptionAgent
│   ├── Weather Advisory Card
│   ├── Itinerary Status (7 stops)
│   ├── Impact Summary
│   ├── Excursion Status Cards (×4)
│   ├── RecommendationCard (×2)
│   ├── AgentTimeline (4 events)
│   ├── Demo Scenario Card
│   └── AgentChat (port-disruption)
├── OnboardOpsAgent
│   ├── Venue Utilization Cards (×8)
│   ├── Maintenance Flags (×3)
│   ├── RecommendationCard (×2)
│   ├── AgentTimeline (3 events)
│   ├── Demo Scenario Card
│   └── AgentChat (onboard-ops)
├── Architecture (technical docs page)
└── GuidedDemo (floating overlay)
```

### Shared Components

| Component | File | Props | Description |
|---|---|---|---|
| `KPICard` | `KPICard.tsx` | `kpi: OperationalKPI` | Displays metric with trend indicator (up/down/neutral), hover glow effect |
| `StatusBadge` | `StatusBadge.tsx` | `status: StatusType` | Universal status pill with dot + color. Supports 18 status types across all domains |
| `RecommendationCard` | `RecommendationCard.tsx` | `recommendation: AgentRecommendation` | Expandable card with reasoning, data sources, per-action approve/reject buttons, confidence score |
| `AgentTimeline` | `AgentTimeline.tsx` | `events: TimelineEvent[]` | Vertical timeline with typed icons (alert, analysis, recommendation, action, resolution, info) |
| `AgentChat` | `AgentChat.tsx` | `agentType, className` | Full NLP chat interface with streaming, markdown rendering, copy-to-clipboard, timestamps |
| `GuidedDemo` | `GuidedDemo.tsx` | (none — global) | 4-step guided walkthrough with live query firing into agent chat panels |
| `NavLink` | `NavLink.tsx` | `className, activeClassName` | Wrapper around React Router's NavLink with conditional class support |

### Chart Components (DashboardCharts.tsx)

| Chart | Type | Data Points | Purpose |
|---|---|---|---|
| `SatisfactionTrendsChart` | Area | 10 days × 4 categories | Shows declining dining scores triggering agent intervention |
| `RevenueProtectedChart` | Bar (stacked) | 10 days × 2 series | Cumulative revenue protected vs. at-risk |
| `AgentConfidenceChart` | Radar | 6 metrics × 3 agents | Comparative agent performance across quality dimensions |

---

## 9. Design System

### Color Tokens (HSL)

All colors are defined as CSS custom properties in `src/index.css` and referenced via Tailwind semantic classes. **No hardcoded colors in components.**

#### Light Mode

| Token | HSL Value | Usage |
|---|---|---|
| `--background` | `0 0% 100%` | Page background |
| `--foreground` | `265 4% 12.9%` | Primary text |
| `--card` | `0 0% 100%` | Card backgrounds |
| `--primary` | `266 4% 20.8%` | Primary actions, active nav, agent icons |
| `--secondary` | `248 0.7% 96.8%` | Secondary backgrounds, data source pills |
| `--muted` | `248 0.7% 96.8%` | Muted backgrounds |
| `--muted-foreground` | `257 4.6% 55.4%` | Secondary text, labels |
| `--destructive` | `27 24.5% 57.7%` | Error states, critical severity |
| `--warning` | `38 92% 50%` | Warning states, pending items |
| `--success` | `152 60% 42%` | Success states, normal operation |
| `--info` | `210 80% 55%` | Informational states, open items |
| `--border` | `256 1.3% 92.9%` | All borders |

#### Dark Mode

Full dark mode tokens defined under `.dark` class. Key differences:
- Card backgrounds use `266 4% 20.8%` (dark surface)
- Borders use `0 0% 100% / 10%` (translucent white)
- Primary inverts to light: `256 1.3% 92.9%`

### Typography

| Font | Weight | Usage |
|---|---|---|
| **Inter** | 300-700 | Primary sans-serif for all UI text |
| **Lora** | 400-700 | Serif (available, not currently used in components) |
| **Space Mono** | 400, 700 | Monospace for IDs, technical data |

Loaded via Google Fonts in `index.css`.

### Spacing & Layout

- **Max content width:** 1400px (pages), 1200px (architecture)
- **Page padding:** `p-6` (24px)
- **Card padding:** `p-4` (16px)
- **Grid gaps:** `gap-3` to `gap-6`
- **Border radius:** `--radius: 0.375rem` (6px), with lg/md/sm variants

### Custom Utilities (index.css)

| Class | Effect |
|---|---|
| `.glow-primary` | Teal box-shadow glow (hover state) |
| `.glow-destructive` | Red glow for error states |
| `.glow-warning` | Amber glow |
| `.glow-success` | Green glow |
| `.card-gradient` | Dark gradient background |
| `.text-gradient` | Teal-to-blue text gradient |
| `.scrollbar-thin` | Custom thin scrollbar (6px width) |

### Animations (tailwind.config.ts)

| Animation | Duration | Usage |
|---|---|---|
| `pulse-glow` | 2s infinite | Agent status dots, critical badges |
| `slide-in` | 0.3s ease-out | Content entrance |
| `fade-in` | 0.4s ease-out | Chart cards staggered entrance |
| `accordion-down/up` | 0.2s ease-out | Expandable sections |

### StatusBadge Color Matrix

The `StatusBadge` component maps 18 status types to consistent color treatments:

| Color | Statuses |
|---|---|
| **Destructive** (red) | critical, high, disrupted, cancelled, rejected, overloaded |
| **Warning** (amber) | reviewing, pending, medium, busy |
| **Success** (green) | approved, executed, rebooked, normal |
| **Info** (blue) | open, scheduled, low |
| **Muted** (gray) | closed, maintenance |

---

## 10. Routing & Navigation

### Route Table

| Path | Component | Description |
|---|---|---|
| `/` | `Dashboard` | Operations command center with KPIs, charts, alerts |
| `/guest-recovery` | `GuestRecoveryAgent` | Guest service recovery agent workspace |
| `/port-disruption` | `PortDisruptionAgent` | Port & excursion disruption agent workspace |
| `/onboard-ops` | `OnboardOpsAgent` | Onboard operations optimization agent workspace |
| `/architecture` | `Architecture` | Technical architecture documentation page |
| `*` | `NotFound` | 404 fallback |

### Navigation Items

Defined in `AppLayout.tsx`:

```typescript
const navItems = [
  { label: "Dashboard",      to: "/",                icon: LayoutDashboard },
  { label: "Guest Recovery",  to: "/guest-recovery",  icon: UserCheck },
  { label: "Port & Excursions", to: "/port-disruption", icon: Ship },
  { label: "Onboard Ops",    to: "/onboard-ops",     icon: Settings2 },
  { label: "Architecture",   to: "/architecture",    icon: FileText },
];
```

Active state: `bg-primary/10 text-primary`

---

## 11. State Management

### Strategy: Local Component State

The application uses **no global state management** (no Redux, Zustand, or Context). All state is local to components:

| Component | State | Type |
|---|---|---|
| `AppLayout` | `collapsed` | `boolean` — sidebar collapse |
| `AgentChat` | `messages`, `input`, `isStreaming` | Chat message array, input text, streaming flag |
| `RecommendationCard` | `expanded`, `status` | Expandable reasoning, local status override |
| `GuidedDemo` | `isOpen`, `currentStep`, `hasCompleted`, `demoFired` | Demo overlay state |

### Cross-Component Communication

The `GuidedDemo` → `AgentChat` communication uses a **CustomEvent** pattern:

```typescript
// GuidedDemo fires:
window.dispatchEvent(new CustomEvent("guided-demo-query", {
  detail: { query: "...", agentType: "guest-recovery" }
}));

// AgentChat listens:
window.addEventListener("guided-demo-query", handler);
```

This decoupled pattern avoids prop drilling and works across the component tree.

---

## 12. Chat & NLP Interface

### AgentChat Architecture

```
┌─────────────────────────────────────────┐
│ Header: Agent name, Capella badge, Online│
├─────────────────────────────────────────┤
│ Empty State:                            │
│   Sparkles icon + suggested queries     │
│                                         │
│ Messages:                               │
│   [User bubble] ────── [timestamp]      │
│   [Bot icon] [Assistant bubble]         │
│              [timestamp] [Copy btn]     │
│                                         │
│ Typing Indicator:                       │
│   [Bot icon] [●  ●  ●] (bounce anim)   │
├─────────────────────────────────────────┤
│ Input: [text field] [Send button]       │
│ Reset button (appears after messages)   │
└─────────────────────────────────────────┘
```

### Response Matching System

The `getMockResponse()` function uses regex pattern matching:

```typescript
const MOCK_RESPONSES: Record<agentType, { patterns: RegExp[]; response: string }[]>
```

**Pattern priority:** Agent-specific patterns are checked first, then general patterns. Fallback response suggests valid query topics.

### Streaming Simulation

Responses are revealed character-by-character at 3 chars per 12ms interval (~250 chars/sec), with a blinking cursor during stream. This simulates LLM token streaming behavior.

### Suggested Queries Per Agent

| Agent | Queries |
|---|---|
| General | Ship status, Active recommendations, Open incidents |
| Guest Recovery | Margaret Chen's incident, Rossi recovery plan, All active incidents |
| Port Disruption | Santorini weather status, Crete excursion, All excursion status |
| Onboard Ops | Dining capacity, Pool/spa status, All venue overview |

### Features

- **Timestamps:** `date-fns` `format(timestamp, "h:mm a")` on every message
- **Copy-to-clipboard:** Hover-reveal button on assistant messages, toast confirmation
- **Markdown rendering:** Full table, heading, list, bold/italic support via `react-markdown`
- **Auto-scroll:** `scrollRef` scrolls to bottom on new messages
- **Reset:** Clears all messages and returns to empty state

---

## 13. Guided Demo System

### 4-Step Walkthrough

| Step | Route | Demo Queries |
|---|---|---|
| 1. Operations Dashboard | `/` | (none — overview only) |
| 2. Guest Recovery Agent | `/guest-recovery` | "Analyze Margaret Chen's incident", "Rossi suite AC critical" |
| 3. Port & Excursion Agent | `/port-disruption` | "Santorini weather disruption status", "alternative excursions available" |
| 4. Onboard Ops Agent | `/onboard-ops` | "Dining capacity status", "staff redeployment recommendations" |

### UX Flow

1. **Entry:** Floating "Guided Demo" button (bottom-right, appears with spring animation after 1s delay)
2. **Panel:** Right-side drawer (400px max) with backdrop blur
3. **Per step:** Icon + title + description → Key Capabilities list (staggered animation) → Live Agent Demo buttons
4. **Query firing:** Button click dispatches `CustomEvent` → AgentChat receives and auto-sends query
5. **Completion:** CheckCircle animation → auto-close after 2.5s

### State Management

- `demoFired` record prevents duplicate query firing per step
- `currentStep` drives both panel content and `navigate()` route changes
- Progress bar animates with Framer Motion

---

## 14. Production Roadmap

### Phase 1 (Current) — MVP Demo

- ✅ Full UI with mock data
- ✅ 3 agent workspaces with context panels, recommendations, timelines
- ✅ NLP chat with pattern-matched responses and streaming simulation
- ✅ Guided demo with live query injection
- ✅ Responsive layout with collapsible sidebar
- ✅ Rich data visualization (3 chart types)

### Phase 2 — Couchbase Capella Integration

| Component | Implementation |
|---|---|
| **Database** | Couchbase Capella as primary operational store |
| **Document Model** | JSON documents for guests, bookings, incidents, venues, excursions |
| **Queries** | N1QL for cross-entity correlation |
| **Real-time** | Sub-document operations for venue/staff updates |
| **Vector Search** | Semantic similarity for guest preferences, incident patterns |
| **Eventing** | Document change triggers for agent activation |
| **Replication** | XDCR for multi-region fleet sync |

### Phase 3 — LLM Agent Orchestration

| Component | Implementation |
|---|---|
| **LLM Provider** | GPT-4 / Claude for natural language reasoning |
| **Orchestration** | LangChain/LangGraph agent pipelines |
| **RAG** | Couchbase Vector Search for context retrieval |
| **Tools** | Agent tools for database queries, API calls, action execution |
| **Approval** | Human-in-the-loop workflows with audit logging |

### Phase 4 — Production Operations

| Component | Implementation |
|---|---|
| **Auth** | Role-based access (bridge, guest services, F&B, engineering) |
| **Real-time** | WebSocket subscriptions for live dashboard updates |
| **Mobile** | Responsive for tablet/phone use by field teams |
| **Audit** | Full action audit trail with CDC |
| **Multi-ship** | Fleet-wide dashboard aggregating across vessels |

---

## 15. Deployment & Infrastructure

### Current (MVP)

- **Hosting:** Lovable preview / published URL
- **Build:** `vite build` produces static SPA
- **Dev server:** Port 8080, HMR overlay disabled

### Production Target

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CDN/Edge   │────▶│  API Gateway │────▶│  Couchbase   │
│  (Static SPA)│     │  (Edge Fns)  │     │  Capella     │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                     ┌──────┴──────┐
                     │  LLM API    │
                     │  (OpenAI /  │
                     │   Anthropic)│
                     └─────────────┘
```

### Environment Variables (Phase 2)

| Variable | Purpose |
|---|---|
| `COUCHBASE_ENDPOINT` | Capella cluster connection string |
| `COUCHBASE_USERNAME` | Database authentication |
| `COUCHBASE_PASSWORD` | Database authentication |
| `COUCHBASE_AI_ENDPOINT` | Capella AI Services URL |
| `COUCHBASE_BUCKET` | Primary bucket name |

---

## 16. Security Considerations

### Current (MVP)

- No authentication (demo mode)
- No API keys in client code
- All data is static mock — no PII exposure
- No backend connectivity

### Production Requirements

| Area | Requirement |
|---|---|
| **Authentication** | SSO integration with cruise line identity provider |
| **Authorization** | Role-based access — separate `user_roles` table (never on profile) |
| **API Security** | Edge functions proxy all database/LLM calls — no direct client access |
| **Data Protection** | Guest PII encrypted at rest and in transit |
| **Audit Trail** | All agent recommendations and approvals logged with timestamps |
| **Rate Limiting** | LLM API calls rate-limited per user/role |
| **CORS** | Strict origin allowlist for API endpoints |

---

## 17. Appendix: File Inventory

### Pages (5 files)

| File | Lines | Description |
|---|---|---|
| `src/pages/Dashboard.tsx` | 115 | Operations command center |
| `src/pages/GuestRecoveryAgent.tsx` | 135 | Guest recovery agent workspace |
| `src/pages/PortDisruptionAgent.tsx` | 151 | Port disruption agent workspace |
| `src/pages/OnboardOpsAgent.tsx` | 118 | Onboard ops agent workspace |
| `src/pages/Architecture.tsx` | 156 | Technical architecture page |

### Components (8 custom + shadcn/ui)

| File | Lines | Description |
|---|---|---|
| `src/components/AppLayout.tsx` | 93 | Sidebar + main content layout |
| `src/components/AgentChat.tsx` | ~350 | NLP chat interface with streaming |
| `src/components/AgentTimeline.tsx` | 57 | Vertical event timeline |
| `src/components/DashboardCharts.tsx` | 129 | 3 Recharts visualizations |
| `src/components/GuidedDemo.tsx` | 341 | Guided demo overlay |
| `src/components/KPICard.tsx` | 28 | KPI metric card |
| `src/components/RecommendationCard.tsx` | 115 | Expandable recommendation card |
| `src/components/StatusBadge.tsx` | 43 | Universal status pill |
| `src/components/NavLink.tsx` | 28 | React Router NavLink wrapper |
| `src/components/ui/*` | ~50 files | shadcn/ui component library |

### Data & Config

| File | Description |
|---|---|
| `src/data/mockData.ts` | 443 lines — all TypeScript interfaces and mock data |
| `src/index.css` | 187 lines — Tailwind config, CSS variables, custom utilities |
| `tailwind.config.ts` | 178 lines — Extended theme with colors, animations, shadows |
| `vite.config.ts` | 20 lines — Vite config with path aliases |
| `components.json` | shadcn/ui configuration |

---

*This document is auto-generated from the VoyageOps AI codebase. For questions or updates, see the repository README or Architecture page within the application.*
