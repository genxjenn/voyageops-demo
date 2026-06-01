# VoyageOps AI — Architecture & Design Specification

> **Version:** 1.3 · **Last Updated:** May 2026  
> **Platform:** Acme Cruise Line · MS Acme Voyager  
> **Status:** Phase 2 active — live Couchbase backend, Guest Recovery LLM chat, Python worker proposals, operator approval API, and live dashboard polling.

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
13. [Operations Dashboard](#13-operations-dashboard-)
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

### Guest Recovery Agent

| Agent | Domain | Trigger Examples |
|---|---|---|
| **Guest Recovery** | Detect service failures, correlate guest value, recommend compensation, run worker proposals | Dining complaint + Platinum guest + high spend; open incident Eventing → `agent_runs` |

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
| **Animation** | Framer Motion 12.35 | Page transitions and micro-interactions |
| **Markdown** | react-markdown 10.1 | Render agent responses with rich formatting |
| **Routing** | React Router 6.30 | Client-side SPA routing |
| **Date Utils** | date-fns 3.6 | Timestamp formatting in chat messages |
| **Server state** | TanStack React Query 5 | API caching, polling (`useLiveDashboardData`, page queries) |
| **UI state** | React useState/useCallback | Chat, selection, collapsibles (no Redux/Zustand) |
| **Notifications** | Sonner 1.7 | Toast notifications for actions |
| **API Backend** | Express + Node.js SDK | `/api/*` routes, Couchbase access, Guest Recovery OpenAI chat/embedding calls |
| **Worker Runtime** | Python + Couchbase SDK | Guest Recovery agent run polling and proposal generation |
| **Database** | Couchbase Capella | Operational JSON documents, SQL++, Eventing, vector indexes |
| **LLM** | OpenAI chat + embeddings | Guest Recovery chat and worker reasoning |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (SPA)                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │ StickyHeader — tab nav (Dashboard / Guest / Arch)  │ │
│  │ Cmd+K palette · VoyageOps branding                 │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ AppLayout — breadcrumb trail + scrollable main      │ │
│  │  • Dashboard (CSAT KPIs, ship bar, recovery card)  │ │
│  │  • GuestRecoveryAgent (chat + 3-column workspace)  │ │
│  │  • Architecture (in-app technical overview)        │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Guest Recovery Express API + Python Worker                             │
│  ┌────────────────┐  ┌────────────────┐                 │
│  │ Couchbase       │  │ Guest Recovery │                │
│  │ Capella DB      │  │ Embeddings     │                │
│  │ (JSON docs,     │  │ (chat, RAG,    │                │
│  │  SQL++, Vector, │  │  structured    │                │
│  │  Eventing)      │  │  guidance)     │                │
│  └────────────────┘  └────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Application Architecture

### Data Model Evolution

**Phase 1 (MVP):** Mock data in `src/data/mockData.ts`

**Phase 2 (Active):** Live Couchbase backend with Guest Recovery LLM chat, worker-generated `action_proposals`, and operator approval. The product UI has two operational surfaces: **Customer Satisfaction Dashboard** (`/`) and **Guest Service Recovery Agent** (`/guest-recovery`). Legacy routes `/port-disruption` and `/onboard-ops` redirect to `/`.

All browser calls use relative `/api/*` paths; Vite proxies them to the Express API.

### Entry Point & Component Tree

```
index.html → src/main.tsx → App.tsx → BrowserRouter → AppLayout → Routes
```

Frontend initialization:
1. `QueryClientProvider` wraps the app for React Query
2. `BrowserRouter` + `AppLayout` (`StickyHeader`, optional breadcrumbs, scrollable `<main>`)
3. Page components call `api.*` helpers from `src/lib/api.ts`

### Local Development

| Process | Command | Port | Role |
|---|---|---|---|
| **Combined dev** | `npm run dev` | — | Runs API + Vite via `concurrently` |
| **API** | `npm run dev:api` | **5173** (`PORT` env) | Express + Couchbase (`src/api/server.ts`) |
| **UI** | `npm run dev:vite` | **8080** | Vite dev server (`vite.config.ts`) |

Proxy: browser `http://localhost:8080/api/*` → `http://localhost:5173/api/*`.

### App.tsx — Root Component

```tsx
<QueryClientProvider>          // React Query (ready for async data)
  <TooltipProvider>            // Global tooltip context
    <Toaster /> <Sonner />     // Dual notification systems
    <BrowserRouter>
      <AppLayout>              // StickyHeader + breadcrumbs + main
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/guest-recovery" element={<GuestRecoveryAgent />} />
          <Route path="/port-disruption" element={<Navigate to="/" replace />} />
          <Route path="/onboard-ops" element={<Navigate to="/" replace />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  </TooltipProvider>
</QueryClientProvider>
```

### AppLayout & StickyHeader

- **`StickyHeader`** — Top tab navigation (Dashboard, Guest Recovery, Architecture), Cmd/Ctrl+K search palette, branding
- **`AppLayout`** — Breadcrumb trail when nested (e.g. Guest Recovery → Dashboard parent), full-height scrollable main region
- **No collapsible sidebar** — navigation is header-based only

---

## 4. Agent System Design

### Guest Recovery Workspace Layout (`/guest-recovery`)

```
┌──────────────────────────────────────────────────────────────────┐
│ AgentChat — Guest Recovery Agent Log (collapsible, default closed) │
│ • POST /api/agent-query  • SSE /api/worker-logs/stream           │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────┬──────────────────────────┬─────────────────────┐
│ Left             │ Center (tabs)            │ Right               │
│ Ranked incidents │ Guest · Context          │ Incident recovery   │
│ by lost revenue  │ • Top-10 guest select    │ proposal            │
│ potential        │ • Profile + active inc.  │ • Chat-focused inc. │
│                  │ • Approval queue (top-10)│ • View Plan list    │
│                  │ • Demo scenario (ctx tab)│ • Worker / chat plan│
└──────────────────┴──────────────────────────┴─────────────────────┘
```

### Guest Recovery Agent — Live Conversational Recovery Planning

**Ranked incidents (left):** `GET /api/incidents/prioritized` — incidents with estimated lost-revenue potential.

**Center column — Guest tab:**
- Top-10 ranked guest selector
- Guest profile (loyalty, cabin, booking, onboard spend, sailing history, notes)
- Active incident summary
- **Recovery Plan Approval Queue** — worker `action_proposals` grouped by severity; approve via `POST /api/action-proposals/:id/approve`
- **Chat-adjusted preview** — in-memory overlay when operator prompts mention adjust/swap/budget keywords; approval can persist `chatPreviewOverlay` on the proposal document

**Center column — Context tab:**
- Collapsible all-incidents list (open vs closed counts)
- Collapsible demo scenario narrative (venue correlation when venue data is available)

**Right column — Incident recovery proposal:**
- `effectivePlanIncidentId` = chat-selected incident or default top open incident for guest
- Worker proposal card when pending; **Agent recovery plan (from chat)** when LLM returned guidance but no worker proposal yet
- **Chat-focused incidents** list with **View Plan** (always selects; no toggle-off)

**AI Chat (`AgentChat`):**
- `logCollapsible` + `defaultLogOpen={false}` — log collapsed by default; operator input remains visible
- User query → `POST /api/agent-query` (`agentType` must be `guest-recovery`)
- Backend resolves explicit incident IDs first, then vector retrieval over incident GSI indexes
- Returns markdown + structured `guidance` (playbook, policy, catalog, operational, missing-artifact drafts)
- `onAgentResponse` stores chat-focused plans per incident ID in parent state
- Live worker activity: `GET /api/worker-logs` + `EventSource` on `/api/worker-logs/stream`
- Retrieval badges: **Vector Mode**, index count, or **Fallback active**

**Worker pipeline (production):**
- Open incident → Capella Eventing → pending `agent_runs`
- Python worker polls, resolves playbook + catalog + policies, LLM JSON plan → `action_proposals`
- Coverage-gap path when no eligible catalog actions (`coverage_gap_drafts_ready`)
- Operator **Approve** → updates proposal + incident status + execution stub (full outcomes analytics still Phase 3)

**Guest selection sync:** `selectedChatIncidentId` resets only when the selected **guest** changes (`lastSyncedGuestIdRef`), not on every prioritized-incidents refetch (~10s).

**Unique data points:** Lifetime value, churn risk, loyalty tier, venue correlation, policy constraints

---

## 5. Data Model & Schema

Guest Recovery reads live Couchbase data through `/api/*`, with mock fallbacks in `mockData.ts` for dashboard KPIs and demo recommendations. TypeScript schemas map directly to Couchbase JSON documents.

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
| `Excursion` | id, name, port, date, time, capacity, booked, pricePerPerson, status, vendor | Seed data / API (optional) |
| `Venue` | id, name, type, deck, capacity, currentOccupancy, waitTime, staffCount, optimalStaff, status | GuestRecoveryAgent (context), seed |
| `AgentRecommendation` | id, agentType, title, summary, reasoning, dataSourcesUsed[], confidence, impact, status, actions[], createdAt, relatedEntityId/Type | Dashboard, GuestRecoveryAgent |
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
| Recommendations | 2 | Guest recovery (Jane Doe, Stark family) |
| Timeline Events | 5 | Guest recovery incident lifecycle |
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
  Backend worker polls agent_runs WHERE status="pending"← IMPLEMENTED
     ↓
  Resolve incident, guest, playbook, actions, policies  ← IMPLEMENTED
     ↓
  LLM prompt assembly + chat/completions call           ← IMPLEMENTED
     ↓
  Agent generates action_proposal (awaiting approval)   ← IMPLEMENTED
     ↓
  Coverage gap drafts if actions are missing            ← IMPLEMENTED
     ↓
  Human approves → POST /api/action-proposals/:id/approve ← IMPLEMENTED (proposal + incident status)
     ↓
  action_execution stub + outcomes analytics            ← PARTIAL / Phase 3
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

### Proposal Statuses

| Status | Meaning |
|---|---|
| `pending` | `agent_runs` document is waiting for worker pickup |
| `awaiting_approval` | Worker generated a concrete proposal for supervisor review |
| `coverage_gap_drafts_ready` | Worker could not find eligible catalog actions and generated draft playbook/action/policy artifacts |
| `approved` / `rejected` / `executed` | Human workflow states for future approval and execution handling |

---

## 7. Vector Retrieval Pipeline

### Embedded Data Seeding

Before agent runs can generate quality proposals, seed agent-scope retrieval data via cluster setup scripts (see `docs/README.manual-setup.md` and `scripts/seed-intelligence-data.ts`).

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

### Guest Recovery Retrieval Flow (`POST /api/agent-query`)

1. **Explicit ID parsing:** Incident IDs in the user query take precedence over semantic retrieval
2. **Embedding:** OpenAI or corpus fallback (token-overlap cosine similarity)
3. **SQL++ Search:** `APPROX_VECTOR_DISTANCE` across incident vector indexes in parallel
4. **Context loading:** Guest profile, existing proposal, recent chat turns, playbooks, policy rules, and action catalog
5. **LLM response:** OpenAI chat completion returns markdown plus structured guidance
6. **Metadata:** Returns retrieval mode, indexes used, embedding source, context IDs, and citation IDs

### Chat UI Integration

For `guest-recovery`, AgentChat displays retrieval and response status:
- **Vector Mode** badge (blue) = indexes active
- **3 indexes active** = count of live GSI vectors
- **Fallback active** warning = using in-memory similarity
- Guest Recovery responses can drive a Chat Focused Plan panel with the latest LLM response for the selected incident

---

## 8. Component Architecture

### Component Hierarchy

```
App
├── AppLayout
│   ├── StickyHeader (tabs + Cmd+K search)
│   └── Breadcrumbs (when applicable)
├── Dashboard — Customer Satisfaction Dashboard
│   ├── KPICard sidebar (compact, live override for recovery opportunities)
│   ├── Ship status bar (live ship-info)
│   ├── Guest Recovery entry card (incidents + pending proposals)
│   └── DashboardCharts (satisfaction, revenue, recovery confidence radar)
├── GuestRecoveryAgent
│   ├── AgentChat (guest-recovery, collapsible log)
│   ├── Prioritized incident cards
│   ├── Tabs: Guest (profile, approval queue) | Context (incidents, demo scenario)
│   ├── RecoveryProposalCard + approve mutation
│   └── Chat-focused incident / plan column
└── Architecture (in-app overview page)
```

### Shared Components

| Component | File | Props | Description |
|---|---|---|---|
| `KPICard` | `KPICard.tsx` | `kpi: OperationalKPI` | Displays metric with trend indicator (up/down/neutral), hover glow effect |
| `StatusBadge` | `StatusBadge.tsx` | `status: StatusType` | Universal status pill with dot + color. Supports 18 status types across all domains |
| `StickyHeader` | `StickyHeader.tsx` | — | Top nav tabs, Cmd+K palette, branding |
| `PageHeading` | `PageHeading.tsx` | — | `PageTitle`, `SectionTitle`, `SubsectionTitle` typography helpers |
| `AgentChat` | `AgentChat.tsx` | `agentType`, `logCollapsible`, `defaultLogOpen`, `onAgentResponse` | Guest Recovery LLM chat, worker log SSE, markdown, streaming simulation |
| `AgentTimeline` | `AgentTimeline.tsx` | `events` | Legacy timeline component (not mounted in current pages) |
| `RecommendationCard` | `RecommendationCard.tsx` | `recommendation` | Legacy recommendation card (not mounted in current pages) |
| `NavLink` | `NavLink.tsx` | — | React Router NavLink wrapper (legacy; header uses plain links) |

### Chart Components (DashboardCharts.tsx)

| Chart | Type | Data Points | Purpose |
|---|---|---|---|
| `SatisfactionTrendsChart` | Area | 10 days × 4 categories | Shows declining dining scores triggering agent intervention |
| `RevenueProtectedChart` | Bar (stacked) | 10 days × 2 series | Cumulative revenue protected vs. at-risk |
| `AgentConfidenceChart` | Radar | 6 metrics × 1 series | Guest Recovery confidence scores (demo chart data) |

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
| `/` | `Dashboard` | Customer Satisfaction Dashboard — KPIs, ship bar, Guest Recovery card, charts |
| `/guest-recovery` | `GuestRecoveryAgent` | Guest service recovery agent workspace |
| `/port-disruption`, `/onboard-ops` | — | Redirect to `/` (legacy URLs) |
| `/architecture` | `Architecture` | Technical architecture documentation page |
| `*` | `NotFound` | 404 fallback |

### Navigation Items

Defined in `StickyHeader.tsx`:

```typescript
const navItems = [
  { label: "Dashboard",     to: "/",               icon: LayoutDashboard },
  { label: "Guest Recovery", to: "/guest-recovery", icon: UserCheck },
  { label: "Architecture",  to: "/architecture",   icon: FileText },
];
```

Active tab: underline + `text-primary`. Global search: **Cmd/Ctrl+K** over `searchableItems`.

---

## 11. State Management

### Strategy: Local Component State

The application uses **no global state management** (no Redux, Zustand, or Context). All state is local to components:

| Component | State | Type |
|---|---|---|
| `StickyHeader` | `searchOpen`, `query`, `selectedIndex` | Cmd+K palette |
| `AgentChat` | `messages`, `input`, `isStreaming`, `logOpen` | Chat + collapsible log panel |
| `GuestRecoveryAgent` | `selectedGuestId`, `selectedChatIncidentId`, `chatFocusedPlansByIncidentId`, … | Guest/incident focus, chat plans, approval |
| `Dashboard` | (none) | Data from `useLiveDashboardData()` hooks |

### Live Dashboard Polling

`useLiveDashboardData()` refetches every **10s** (`refetchInterval`) with `staleTime: 5s` for:

- `["kpis"]`, `["incidents"]`, `["recommendations"]`, `["action-proposals"]`

The **Guest Recovery Opportunities** KPI value is overridden client-side to match open/reviewing incident count. **Pending Proposals** on the dashboard card uses pending `action_proposals` from the API.

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

### Response Generation System

For `guest-recovery`, `AgentChat` calls `api.agentQuery()` and renders the live LLM response. It also emits the full `AgentQueryResponse` to `GuestRecoveryAgent`, which stores chat-focused plans by incident ID.

The `general` agent type uses deterministic demo responses through `getAgentResponse()` for exploration outside the recovery workspace.

### Streaming Simulation

Responses are revealed character-by-character at 3 chars per 12ms interval (~250 chars/sec), with a blinking cursor during stream. This simulates LLM token streaming behavior.

### Suggested Queries Per Agent

| Agent | Queries |
|---|---|
| General | Ship status, Active recommendations, Open incidents |
| Guest Recovery | Jane Doe's incident, Stark family recovery plan, All active incidents |

### Guest Recovery Verbosity

`GUEST_RECOVERY_CHAT_VERBOSITY=concise|normal|detailed` controls the chat prompt and how much structured guidance is appended. Concise mode asks the LLM for 3-5 bullets and only includes missing artifacts when relevant.

### Features

- **Timestamps:** `date-fns` `format(timestamp, "h:mm a")` on every message
- **Copy-to-clipboard:** Hover-reveal button on assistant messages, toast confirmation
- **Markdown rendering:** Full table, heading, list, bold/italic support via `react-markdown`
- **Auto-scroll:** `scrollRef` scrolls to bottom on new messages
- **Reset:** Clears all messages and returns to empty state

---

## 13. Operations Dashboard (`/`)

The dashboard title in UI is **Customer Satisfaction Dashboard**.

| Region | Data source | Behavior |
|---|---|---|
| KPI sidebar | `GET /api/dashboard/kpis` + mock fallback | Compact cards; **Guest Recovery Opportunities** count from live open/reviewing incidents |
| Ship bar | `GET /api/ship-info` | Voyage, location, passengers, next port ETA |
| Guest Recovery card | incidents + `action-proposals` | Links to `/guest-recovery`; shows open/reviewing count and pending proposal count |
| Charts | Static demo series in `DashboardCharts.tsx` | Satisfaction trend, revenue protected, recovery agent confidence radar |

Legacy agent routes (`/port-disruption`, `/onboard-ops`) redirect to `/` for bookmark compatibility.

---

## 14. Production Roadmap

### Phase 1 — MVP Demo

- ✅ Full UI with mock data fallbacks
- ✅ Guest Recovery workspace (3-column layout + approval queue)
- ✅ Guest Recovery live LLM chat; `general` agent type uses deterministic fallback in `AgentChat`
- ✅ Sticky header navigation + Cmd+K search
- ✅ Rich data visualization (3 chart types)

### Phase 2 (Active) — Couchbase Capella + Guest Recovery Agent

| Component | Implementation |
|---|---|
| **Database** | Couchbase Capella as primary operational store |
| **Document Model** | JSON documents for guests, bookings, incidents, venues, excursions |
| **Queries** | N1QL for cross-entity correlation |
| **Real-time** | Sub-document operations for venue/staff updates |
| **Vector Search** | Semantic similarity for guest preferences, incident patterns |
| **Eventing** | Document change triggers for agent activation |
| **Guest Recovery Chat** | Conversational LLM response with structured guidance and missing-artifact drafts |
| **Worker Loop** | Python worker processes `agent_runs` and writes `action_proposals` |
| **Operator Approval** | `POST /api/action-proposals/:id/approve` updates proposal and incident |
| **Live Dashboard** | React Query polling for KPIs, incidents, proposals |
| **Replication** | XDCR for multi-region fleet sync (target) |

### Phase 3 — Approval, Execution, and Broader Agent Orchestration

| Component | Implementation |
|---|---|
| **LLM Provider** | OpenAI is live for Guest Recovery; additional providers can be added later |
| **Orchestration** | LangChain/LangGraph agent pipelines |
| **RAG** | Couchbase Vector Search and SQL++ context retrieval |
| **Tools** | Agent tools for database queries, API calls, action execution |
| **Approval** | Full execution write-back, outcomes documents, governance for draft artifacts |

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

### Current

- **Hosting:** Lovable preview / published URL (static SPA + separate API process in production)
- **Build:** `npm run build` → `dist/` static assets
- **Dev:** `npm run dev` — Express on **5173**, Vite on **8080**, proxy `/api` → API
- **API:** `src/api/server.ts`, repo-root `.env` via `dotenv`
- **Worker:** `npm run demo:worker` → `backend/python/guest_recovery/run_worker_loop.py`

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
| `COUCHBASE_USER` | Database authentication |
| `COUCHBASE_PASSWORD` | Database authentication |
| `COUCHBASE_BUCKET` | Primary bucket name |
| `OPENAI_API_KEY` | OpenAI chat and embedding calls |
| `OPENAI_MODEL` | Chat completion model override |
| `OPENAI_EMBEDDING_MODEL` | Embedding model override |
| `GUEST_RECOVERY_CHAT_VERBOSITY` | `concise`, `normal`, or `detailed` chat response style |
| `GUEST_RECOVERY_QUERY_TIMEOUT_SECONDS` | Worker pending-run query timeout |
| `GUEST_RECOVERY_POLL_MAX_ATTEMPTS` | Worker pending-run retry attempts |
| `PORT` | Express listen port (default `5173`) |
| `VITE_API_BASE_URL` | Optional absolute API base (empty = same-origin `/api` via proxy) |

---

## 16. Security Considerations

### Current

- No authentication (demo mode)
- No API keys in client code
- Guest Recovery uses live Capella data when configured; mock fallbacks when API unavailable
- Backend and worker connectivity use server-side `.env`; frontend never receives Couchbase or OpenAI credentials

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

### Pages

| File | Lines (approx.) | Description |
|---|---|---|
| `src/pages/Dashboard.tsx` | 153 | Customer Satisfaction Dashboard |
| `src/pages/GuestRecoveryAgent.tsx` | 1290 | Guest recovery workspace |
| `src/pages/Architecture.tsx` | 159 | In-app architecture overview |
| `src/pages/NotFound.tsx` | 24 | 404 fallback |
| `src/pages/Index.tsx` | 14 | Redirect stub |

Removed from product (redirect only): `PortDisruptionAgent`, `OnboardOpsAgent`.

### Key components

| File | Lines (approx.) | Description |
|---|---|---|
| `src/components/AppLayout.tsx` | 53 | Sticky header wrapper + breadcrumbs |
| `src/components/StickyHeader.tsx` | 171 | Tab nav + Cmd+K search |
| `src/components/AgentChat.tsx` | 779 | Guest Recovery chat + worker logs |
| `src/components/DashboardCharts.tsx` | 127 | Recharts dashboard visuals |
| `src/components/KPICard.tsx` | — | KPI metric card (`compact` on dashboard) |
| `src/components/StatusBadge.tsx` | — | Universal status pill |
| `src/lib/api.ts` | ~390 | API client + `useLiveDashboardData` |
| `src/api/routes.ts` | ~2600 | Express routes (incidents, agent-query, proposals, worker-logs) |
| `src/components/ui/*` | ~50 files | shadcn/ui primitives |

### Data & Config

| File | Description |
|---|---|
| `src/data/mockData.ts` | TypeScript interfaces + mock fallbacks (guest-recovery only in UI) |
| `vite.config.ts` | Vite port 8080, `/api` proxy to 5173 |
| `src/index.css` | 187 lines — Tailwind config, CSS variables, custom utilities |
| `tailwind.config.ts` | 178 lines — Extended theme with colors, animations, shadows |
| `vite.config.ts` | 20 lines — Vite config with path aliases |
| `components.json` | shadcn/ui configuration |

---

*This document is auto-generated from the VoyageOps AI codebase. For questions or updates, see the repository README or Architecture page within the application.*
