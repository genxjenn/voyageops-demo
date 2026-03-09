# VoyageOps AI — Couchbase Integration Guide

> **Version:** 1.0 · **Last Updated:** March 2026  
> **Purpose:** Step-by-step migration from mock data to live Couchbase (Server or Capella)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Deployment Options](#2-deployment-options)
3. [SDK Setup](#3-sdk-setup)
4. [Bucket & Collection Schema](#4-bucket--collection-schema)
5. [Integration Points by File](#5-integration-points-by-file)
6. [Migration Steps](#6-migration-steps)
7. [Query Reference](#7-query-reference)
8. [AI & NLP Integration](#8-ai--nlp-integration)
9. [Real-Time Features](#9-real-time-features)
10. [Security & Connection Management](#10-security--connection-management)

---

## 1. Overview

VoyageOps AI currently uses static mock data in `src/data/mockData.ts`. Every data entity maps 1:1 to a Couchbase JSON document. The frontend is pre-wired with `@tanstack/react-query` and code comments marking each integration point.

**Architecture:**
```
React SPA  →  Edge Functions (API Layer)  →  Couchbase SDK  →  Couchbase (Capella or Server)
```

---

## 2. Deployment Options

| Feature | Couchbase Capella (DBaaS) | Couchbase Server (Self-Managed) |
|---|---|---|
| **Hosting** | Fully managed cloud | On-prem / private cloud / K8s |
| **Setup** | Console or Terraform | Manual or Autonomous Operator |
| **SQL++** | ✅ Full support | ✅ Full support (same syntax) |
| **Full-Text Search** | ✅ Managed FTS | ✅ FTS Service |
| **Eventing** | ✅ Capella Eventing | ✅ Eventing Service |
| **Analytics** | ✅ Columnar (RT-OLAP) | ✅ Analytics Service |
| **AI Services** | ✅ Capella AI Services (Vector Search, RAG) | ❌ Use external LLM + FTS |
| **Mobile Sync** | ✅ App Services | ✅ Sync Gateway |
| **SDK Code** | Portable — same API | Portable — same API |

### Documentation Links

- **Capella:** https://docs.couchbase.com/cloud/get-started/intro.html
- **Server:** https://docs.couchbase.com/server/current/introduction/intro.html
- **SDK Portal:** https://docs.couchbase.com/home/sdk.html

---

## 3. SDK Setup

### Node.js SDK (for Edge Functions / API Layer)

```bash
npm install couchbase
```

**Capella Connection:**
```typescript
import { connect } from 'couchbase';

const cluster = await connect('couchbases://cb.<endpoint>.cloud.couchbase.com', {
  username: Deno.env.get('COUCHBASE_USER'),
  password: Deno.env.get('COUCHBASE_PASSWORD'),
  configProfile: 'wanDevelopment', // Required for Capella
});

const bucket = cluster.bucket('voyageops');
const scope = bucket.scope('operations');
const collection = scope.collection('venues');
```

**Server Connection:**
```typescript
import { connect } from 'couchbase';

const cluster = await connect('couchbase://your-server-host', {
  username: Deno.env.get('COUCHBASE_USER'),
  password: Deno.env.get('COUCHBASE_PASSWORD'),
});

const bucket = cluster.bucket('voyageops');
const scope = bucket.scope('operations');
const collection = scope.collection('venues');
```

> **Key difference:** Capella uses `couchbases://` (TLS) + `configProfile: 'wanDevelopment'`. Server uses `couchbase://`. All subsequent SDK calls are identical.

### SDK Documentation
- Node.js: https://docs.couchbase.com/nodejs-sdk/current/hello-world/overview.html
- Python: https://docs.couchbase.com/python-sdk/current/hello-world/overview.html
- Java: https://docs.couchbase.com/java-sdk/current/hello-world/overview.html

---

## 4. Bucket & Collection Schema

```
Bucket: voyageops
├── Scope: guests
│   ├── Collection: guests          → Guest documents
│   ├── Collection: bookings        → Booking documents
│   └── Collection: incidents       → Incident documents
├── Scope: excursions
│   ├── Collection: excursions      → Excursion documents
│   └── Collection: itinerary       → ItineraryStop documents
├── Scope: operations
│   ├── Collection: venues          → Venue documents (IoT sensor data)
│   ├── Collection: staff_schedules → Staff scheduling documents
│   └── Collection: maintenance     → Maintenance flag documents
└── Scope: intelligence
    ├── Collection: recommendations → AgentRecommendation documents
    ├── Collection: timeline_events → TimelineEvent documents
    ├── Collection: kpis            → Pre-computed KPI documents
    └── Collection: ship_info       → Ship metadata (single document)
```

### Required Indexes

```sql
-- Primary indexes (development only — remove in production)
CREATE PRIMARY INDEX ON voyageops.guests.guests;
CREATE PRIMARY INDEX ON voyageops.guests.incidents;
CREATE PRIMARY INDEX ON voyageops.excursions.excursions;
CREATE PRIMARY INDEX ON voyageops.operations.venues;
CREATE PRIMARY INDEX ON voyageops.intelligence.recommendations;

-- Production indexes
CREATE INDEX idx_incidents_status ON voyageops.guests.incidents(status, severity);
CREATE INDEX idx_incidents_guest ON voyageops.guests.incidents(guestId);
CREATE INDEX idx_excursions_status ON voyageops.excursions.excursions(status);
CREATE INDEX idx_venues_status ON voyageops.operations.venues(status, currentOccupancy);
CREATE INDEX idx_recommendations_agent ON voyageops.intelligence.recommendations(agentType, status);
CREATE INDEX idx_recommendations_status ON voyageops.intelligence.recommendations(status);
CREATE INDEX idx_guests_loyalty ON voyageops.guests.guests(loyaltyTier, onboardSpend DESC);
```

---

## 5. Integration Points by File

### `src/data/mockData.ts` — Data Layer
| Mock Export | Couchbase Collection | Query Pattern |
|---|---|---|
| `guests` | `voyageops.guests.guests` | SQL++ `SELECT * FROM` |
| `bookings` | `voyageops.guests.bookings` | SQL++ with `JOIN` on guestId |
| `incidents` | `voyageops.guests.incidents` | SQL++ filtered by status/severity |
| `excursions` | `voyageops.excursions.excursions` | SQL++ filtered by status |
| `venues` | `voyageops.operations.venues` | SQL++ or Sub-Document API for IoT |
| `agentRecommendations` | `voyageops.intelligence.recommendations` | SQL++ filtered by agentType |
| `shipInfo` | `voyageops.intelligence.ship_info` | KV `get("ship_info::current")` |
| `dashboardKPIs` | `voyageops.intelligence.kpis` | KV get or Analytics aggregation |
| Timeline arrays | `voyageops.intelligence.timeline_events` | SQL++ filtered by agentType, ordered by timestamp |

### `src/pages/Dashboard.tsx` — Aggregated Views
```typescript
// REPLACE: Static imports with React Query hooks
// Capella: SQL++ aggregations or Capella Analytics (Columnar) for heavy KPIs
// Server:  N1QL aggregations or Analytics Service for cross-collection queries

const { data: kpis } = useQuery({ queryKey: ['kpis'], queryFn: () =>
  fetch('/api/dashboard/kpis').then(r => r.json())
});
```

### `src/pages/GuestRecoveryAgent.tsx` — Guest & Incident Data
```typescript
// REPLACE: guests[0], incidents filtering
// Capella/Server: SQL++ JOIN across guests + incidents + bookings
// Query: SELECT g.*, i.* FROM voyageops.guests.guests g
//        JOIN voyageops.guests.incidents i ON i.guestId = g.id
//        WHERE i.status != 'closed'
```

### `src/pages/PortDisruptionAgent.tsx` — Excursion & Weather Data
```typescript
// REPLACE: excursions, itinerary, weatherAdvisory
// Capella/Server: SQL++ on excursions collection
// Weather: External NOAA API cached in Couchbase with TTL
// Capella: Capella AI Services for disruption probability scoring
// Server:  Eventing triggers on weather document updates
```

### `src/pages/OnboardOpsAgent.tsx` — Venue & Staffing Data
```typescript
// REPLACE: venues, maintenance flags
// Capella/Server: SQL++ on venues collection
// IoT Updates: Sub-Document API for partial venue updates (occupancy, waitTime)
//   Docs: https://docs.couchbase.com/nodejs-sdk/current/howtos/subdocument-operations.html
// Capella: Capella AI Services for demand prediction
// Server:  Eventing for auto-alerts when occupancy > threshold
```

### `src/components/AgentChat.tsx` — NLP Chat Interface
```typescript
// REPLACE: Pattern-matched mock responses
// Capella: Capella AI Services (Vector Search + RAG pipeline)
//   Docs: https://docs.couchbase.com/cloud/vector-search/vector-search.html
// Server:  Full-Text Search (FTS) + external LLM (GPT-4/Claude via API)
//   Docs: https://docs.couchbase.com/server/current/fts/fts-introduction.html
```

### `src/components/RecommendationCard.tsx` — Approval Workflow
```typescript
// REPLACE: In-memory status updates (toast only)
// Capella/Server: Sub-Document API mutation
//   await collection.mutateIn('rec::' + id, [
//     MutateInSpec.replace('status', 'approved'),
//     MutateInSpec.insert('approvedAt', new Date().toISOString()),
//     MutateInSpec.insert('approvedBy', currentUser.id),
//     MutateInSpec.arrayAppend('auditLog', { action: 'approved', ... })
//   ]);
```

---

## 6. Migration Steps

### Phase 1 — Infrastructure Setup

1. **Provision Couchbase**
   - **Capella:** Create cluster at https://cloud.couchbase.com → Create bucket `voyageops` → Create scopes/collections per schema above
   - **Server:** Install Couchbase Server → Create bucket → Configure scopes/collections

2. **Store Credentials**
   - Store `COUCHBASE_USER`, `COUCHBASE_PASSWORD`, `COUCHBASE_ENDPOINT` as secrets (Edge Function environment variables)
   - Never expose credentials in frontend code

3. **Create Indexes**
   - Run the index creation statements from Section 4 via Query Workbench (Capella) or cbq shell (Server)

4. **Seed Data**
   - Use the mock data objects from `mockData.ts` as seed documents
   - Insert via SDK `collection.upsert(docId, document)` or cbimport tool

### Phase 2 — API Layer (Edge Functions)

Create Edge Functions for each data domain:

| Endpoint | Method | Couchbase Operation | Source File |
|---|---|---|---|
| `/api/dashboard/kpis` | GET | SQL++ aggregation across all scopes | Dashboard.tsx |
| `/api/guests/:id` | GET | KV get + SQL++ join incidents | GuestRecoveryAgent.tsx |
| `/api/incidents` | GET | SQL++ with status/severity filters | Dashboard.tsx, GuestRecoveryAgent.tsx |
| `/api/excursions` | GET | SQL++ with status filter | PortDisruptionAgent.tsx |
| `/api/venues` | GET | SQL++ ordered by occupancy | OnboardOpsAgent.tsx |
| `/api/recommendations` | GET | SQL++ filtered by agentType | All agent pages |
| `/api/recommendations/:id` | PATCH | Sub-Document mutateIn (status update) | RecommendationCard.tsx |
| `/api/chat` | POST | Capella AI Services or FTS + LLM | AgentChat.tsx |
| `/api/timeline/:agentType` | GET | SQL++ ordered by timestamp DESC | All agent pages |

### Phase 3 — Frontend Migration

Replace mock imports with React Query hooks:

```typescript
// Before (mock):
import { venues } from "@/data/mockData";

// After (live):
import { useQuery } from "@tanstack/react-query";

const { data: venues, isLoading } = useQuery({
  queryKey: ['venues'],
  queryFn: () => supabase.functions.invoke('get-venues').then(r => r.data),
  refetchInterval: 30_000, // Poll every 30s for near-real-time
});
```

### Phase 4 — Real-Time & AI

- Enable Eventing Service for proactive alerts (Server) or Capella Eventing
- Integrate Capella AI Services for vector search and RAG-based chat
- Add WebSocket/SSE for live venue occupancy updates

---

## 7. Query Reference

### Dashboard KPIs (Analytics/Aggregation)
```sql
-- Active incidents by severity
SELECT severity, COUNT(*) as count
FROM voyageops.guests.incidents
WHERE status IN ['open', 'reviewing']
GROUP BY severity;

-- Revenue at risk from disrupted excursions
SELECT SUM(e.pricePerPerson * e.booked) as revenueAtRisk
FROM voyageops.excursions.excursions e
WHERE e.status IN ['disrupted', 'cancelled'];

-- Venue capacity utilization
SELECT name, ROUND((currentOccupancy / capacity) * 100, 1) as utilizationPct
FROM voyageops.operations.venues
ORDER BY utilizationPct DESC;
```

### Guest Recovery — Guest Profile with Incidents
```sql
SELECT g.*, ARRAY_AGG(i) as incidents
FROM voyageops.guests.guests g
LEFT JOIN voyageops.guests.incidents i ON i.guestId = g.id
WHERE g.id = $guestId
GROUP BY g;
```

### Port Disruption — Affected Excursions
```sql
SELECT e.*, 
       (e.pricePerPerson * e.booked) as revenueImpact,
       CASE WHEN e.status = 'disrupted' THEN 'requires_action' ELSE e.status END as actionStatus
FROM voyageops.excursions.excursions e
WHERE e.status IN ['disrupted', 'cancelled']
ORDER BY revenueImpact DESC;
```

### Onboard Ops — Venue Alerts with Staff Gaps
```sql
SELECT v.*,
       ROUND((v.currentOccupancy / v.capacity) * 100, 1) as occupancyPct,
       (v.optimalStaff - v.staffCount) as staffGap
FROM voyageops.operations.venues v
WHERE v.status IN ['busy', 'overloaded']
   OR (v.optimalStaff - v.staffCount) > 0
ORDER BY occupancyPct DESC;
```

---

## 8. AI & NLP Integration

### Option A — Capella AI Services

```
User Query → Edge Function → Capella Vector Search (semantic similarity)
                            → Retrieved context documents
                            → LLM prompt with context (RAG)
                            → Structured response → React UI
```

- **Vector Search:** https://docs.couchbase.com/cloud/vector-search/vector-search.html
- **AI Services:** https://docs.couchbase.com/ai/get-started/intro.html
- Create vector embeddings for recommendations, incident history, and operational procedures
- Use similarity search to find relevant context for agent queries

### Option B — Server FTS + External LLM

```
User Query → Edge Function → Couchbase FTS (keyword/fuzzy match)
                            → Retrieved context documents
                            → External LLM API (GPT-4, Claude, etc.)
                            → Structured response → React UI
```

- **FTS:** https://docs.couchbase.com/server/current/fts/fts-introduction.html
- Create FTS indexes on recommendation summaries, incident descriptions, venue names
- Pass retrieved documents as context to external LLM API

---

## 9. Real-Time Features

### Eventing Service (Server & Capella)

Auto-trigger actions on document changes:

```javascript
// Couchbase Eventing Function: venue_alert_trigger
function OnUpdate(doc, meta) {
  if (doc.type === 'venue') {
    const occupancyPct = (doc.currentOccupancy / doc.capacity) * 100;
    if (occupancyPct > 90) {
      // Insert alert into recommendations collection
      dst_collection['alert::' + meta.id] = {
        agentType: 'onboard-ops',
        title: `${doc.name} at ${occupancyPct.toFixed(0)}% capacity`,
        status: 'pending',
        impact: 'high',
        createdAt: new Date().toISOString()
      };
    }
  }
}
```

- **Capella Eventing:** https://docs.couchbase.com/cloud/eventing/eventing-overview.html
- **Server Eventing:** https://docs.couchbase.com/server/current/eventing/eventing-overview.html

### Sub-Document API (IoT Sensor Updates)

Efficiently update individual venue fields without full document replacement:

```typescript
// Update only occupancy and waitTime from IoT sensor
await collection.mutateIn('venue::le-bordeaux', [
  MutateInSpec.replace('currentOccupancy', 187),
  MutateInSpec.replace('waitTime', 22),
  MutateInSpec.replace('lastSensorUpdate', new Date().toISOString()),
]);
```

- **Docs:** https://docs.couchbase.com/nodejs-sdk/current/howtos/subdocument-operations.html

---

## 10. Security & Connection Management

### Credential Storage
- Store all Couchbase credentials as Edge Function secrets (never in frontend code)
- Required secrets: `COUCHBASE_ENDPOINT`, `COUCHBASE_USER`, `COUCHBASE_PASSWORD`
- Optional: `COUCHBASE_BUCKET` (defaults to `voyageops`)

### RBAC (Role-Based Access Control)
- **Capella:** Configure database users with scoped permissions via Capella UI
- **Server:** Create RBAC users with bucket/scope/collection-level permissions
- Docs: https://docs.couchbase.com/server/current/learn/security/roles.html

### Network Security
- **Capella:** IP allowlisting + TLS by default
- **Server:** Configure TLS certificates + firewall rules
- Edge Functions act as the sole gateway — frontend never connects to Couchbase directly

---

## Quick Reference: File → Integration Map

| Source File | What to Replace | Couchbase Service |
|---|---|---|
| `src/data/mockData.ts` | All static exports | SQL++ queries via Edge Functions |
| `src/pages/Dashboard.tsx` | `dashboardKPIs`, `incidents`, etc. | Analytics Service (KPIs), SQL++ (lists) |
| `src/pages/GuestRecoveryAgent.tsx` | `guests[0]`, `incidents`, timeline | SQL++ JOIN, KV get |
| `src/pages/PortDisruptionAgent.tsx` | `excursions`, `itinerary`, weather | SQL++, external API + cache |
| `src/pages/OnboardOpsAgent.tsx` | `venues`, maintenance flags | SQL++, Sub-Document API (IoT) |
| `src/components/AgentChat.tsx` | Pattern-matched responses | Capella AI Services / FTS + LLM |
| `src/components/RecommendationCard.tsx` | Toast-only approve/reject | Sub-Document mutateIn |
| `src/components/DashboardCharts.tsx` | Hardcoded chart data | Analytics Service aggregations |
