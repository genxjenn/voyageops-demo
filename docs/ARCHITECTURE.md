# VoyageOps AI — Architecture & Design Specification

> **Version:** 1.0 · **Last Updated:** March 2026  
> **Platform:** Acme Cruise Line · MS Acme Voyager  
> **Status:** MVP (Phase 1 — Mock Data) with production architecture defined

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Application Architecture](#3-application-architecture)
4. [Agent System Design](#4-agent-system-design)
5. [Data Model & Schema](#5-data-model--schema)
6. [Component Architecture](#6-component-architecture)
7. [Design System](#7-design-system)
8. [Routing & Navigation](#8-routing--navigation)
9. [State Management](#9-state-management)
10. [Chat & NLP Interface](#10-chat--nlp-interface)
11. [Guided Demo System](#11-guided-demo-system)
12. [Production Roadmap](#12-production-roadmap)
13. [Deployment & Infrastructure](#13-deployment--infrastructure)
14. [Security Considerations](#14-security-considerations)
15. [Appendix: File Inventory](#15-appendix-file-inventory)

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

## 3. Application Architecture

### Entry Point

```
index.html → src/main.tsx → App.tsx → BrowserRouter → AppLayout → Routes
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

### Guest Recovery Agent (`/guest-recovery`)

**Context Panel:**
- Guest profile card (name, loyalty tier, cabin, booking, spend, sailing history, notes)
- Active incident card (ID, severity badge, status badge, timestamps)
- All incidents list with severity/status badges

**Unique data points:** Lifetime value estimation, churn risk percentage, first-complaint-ever flag

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

## 6. Component Architecture

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

## 7. Design System

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

## 8. Routing & Navigation

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

## 9. State Management

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

## 10. Chat & NLP Interface

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

## 11. Guided Demo System

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

## 12. Production Roadmap

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

## 13. Deployment & Infrastructure

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

## 14. Security Considerations

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

## 15. Appendix: File Inventory

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
