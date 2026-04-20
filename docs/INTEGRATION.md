# VoyageOps AI — Couchbase Integration Guide

> **Version:** 2.0 · **Last Updated:** April 2026  
> **Purpose:** Backend wiring, agent scope, vector retrieval, and Capella Eventing configuration

> **Status:** Phase 2 Active — Live backend with vector endpoint, agent scope, Eventing trigger, and seeded retrieval data

---

## Table of Contents

1. [Overview](#1-overview)
2. [Deployment Options](#2-deployment-options)
3. [SDK Setup](#3-sdk-setup)
4. [Bucket & Collection Schema](#4-bucket--collection-schema)
5. [Couchbase SDK Accessors (db object)](#5-couchbase-sdk-accessors-db-object)
6. [Capella Eventing Configuration](#6-capella-eventing-configuration)
7. [Agent Seed Data](#8-agent-seed-data)
8. [Integration Points by File](#9-integration-points-by-file)
9. [Migration Steps](#10-migration-steps)
10. [Query Reference](#11-query-reference)
11. [AI & NLP Integration](#12-ai--nlp-integration)
12. [Real-Time Features](#13-real-time-features)
13. [Security & Connection Management](#14-security--connection-management)

---

## 1. Overview

VoyageOps AI has a live Express backend (`src/api/server.ts`) with all API routes wired to Couchbase Capella via the Node.js SDK. The frontend calls `/api/*` endpoints which are proxied from Vite to the backend.

**Current Architecture:**
```
React SPA → Vite /api/* proxy → Express (src/api/server.ts) → Couchbase SDK → Couchbase Capella
```

**What is live:**
- Guest, incident, venue, excursion, recommendation, and KPI endpoints
- Vector-powered agent query endpoint (`POST /api/agent-query`)
- Agent scope: 7 collections, primary indexes, and 3 vector indexes
- Capella Eventing function triggering on new open incidents
- Seeded retrieval data (action_catalog, playbooks, policy_rules)

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
├── Scope: intelligence
│   ├── Collection: recommendations → AgentRecommendation documents
│   ├── Collection: timeline_events → TimelineEvent documents
│   ├── Collection: kpis            → Pre-computed KPI documents
│   └── Collection: ship_info       → Ship metadata (single document)
├── Scope: agent
│   ├── Collection: agent_runs      → Agent execution runs (triggered by Eventing)
│   ├── Collection: action_proposals → Pending recommendations for approval
│   ├── Collection: action_executions → Approved + executed actions
│   ├── Collection: action_catalog  → Lookup library (seeded with embeddings)
│   ├── Collection: playbooks       → Workflow templates (seeded with embeddings)
│   ├── Collection: policy_rules    → Constraints & guardrails (seeded)
│   └── Collection: outcomes        → Measurement results (with embeddings)
└── Scope: eventing
    └── Collection: sysdata         → Capella Eventing internal state (metadata keyspace)
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

-- Agent scope operational indexes
CREATE PRIMARY INDEX ON voyageops.agent.agent_runs;
CREATE PRIMARY INDEX ON voyageops.agent.action_proposals;
CREATE PRIMARY INDEX ON voyageops.agent.action_executions;
CREATE PRIMARY INDEX ON voyageops.agent.action_catalog;
CREATE PRIMARY INDEX ON voyageops.agent.playbooks;
CREATE PRIMARY INDEX ON voyageops.agent.policy_rules;

## Vector Retrieval \u2014 Incidents

The `POST /api/agent-query` endpoint provides semantic retrieval over `voyageops.guests.incidents`.

### Environment Variables

```
OPENAI_API_KEY=sk-...              # Required for embedding generation
OPENAI_EMBEDDING_MODEL=text-embedding-3-small  # Optional, defaults to text-embedding-3-small
CB_VECTOR_INDEX_CATEGORY=          # Optional: override active index name for vector_category_incidents
CB_VECTOR_INDEX_TYPE=              # Optional: override active index name for vector_type_incidents
CB_VECTOR_INDEX_DESC=              # Optional: override active index name for vector_desc_incidents
```

### Vector Indexes on Incidents (pre-existing in Capella)

| Index Name | Field |
|---|---|
| `hyperscale_voGuestIncidentOpenAI_vector_category_incidents` | `vector_category_incidents` |
| `hyperscale_voGuestIncidentOpenAI_vector_type_incidents` | `vector_type_incidents` |
| `hyperscale_voGuestIncidentOpenAI_vector_desc_incidents` | `vector_desc_incidents` |

All are SQL++ GSI-style vector indexes (not FTS). Access via `APPROX_VECTOR_DISTANCE`. Do not use `cluster.search()` SDK calls.

### Retrieval Response

```json
{
  "response": "Markdown formatted list of similar incidents",
  "incidents": [...],
  "metadata": {
    "embeddingSource": "openai",
    "retrievalMode": "vector-index",
    "indexesAttempted": ["idx1", "idx2", "idx3"],
    "indexesUsed": ["idx1", "idx2", "idx3"]
  }
}
---

## 5. Couchbase SDK Accessors (db object)

All Couchbase access goes through the `db` object in `src/lib/couchbase.ts`. Use typed accessors rather than inline `bucket.scope().collection()` calls.

```typescript
import { db } from '@/lib/couchbase';

// Existing scopes
db.cluster               // raw Couchbase cluster
db.bucket                // raw bucket handle
db.guests                // voyageops.guests.guests
db.bookings              // voyageops.guests.bookings
db.incidents             // voyageops.guests.incidents
db.excursions            // voyageops.excursions.excursions
db.venues                // voyageops.operations.venues
db.recommendations       // voyageops.intelligence.recommendations
db.timeline              // voyageops.intelligence.timeline_events
db.kpis                  // voyageops.intelligence.kpis
db.shipInfo              // voyageops.intelligence.ship_info

// Agent scope (added April 2026)
db.agentRuns             // voyageops.agent.agent_runs
db.actionProposals       // voyageops.agent.action_proposals
db.actionExecutions      // voyageops.agent.action_executions
db.actionCatalog         // voyageops.agent.action_catalog
db.playbooks             // voyageops.agent.playbooks
db.policyRules           // voyageops.agent.policy_rules
```

---

## 6. Capella Eventing Configuration

### Function Settings

| Setting | Value |
|---|---|
| **Source collection** | `voyageops.guests.incidents` |
| **Metadata collection** | `voyageops.eventing.sysdata` |
| **Function name** | `guest_recovery_trigger` (suggested) |
| **Language** | JavaScript |
| **Handler** | `OnUpdate` + `OnDelete` (no-op) |

### Bucket Bindings Required

| Alias | Collection | Access |
|---|---|---|
| `dst` | `voyageops.agent.agent_runs` | Read + Write |

### OnUpdate Handler (production-safe, idempotent)

```javascript
function OnUpdate(doc, meta) {
  try {
    if (!doc || doc.status !== "open") return;
    if (!doc.guestId) return;

    var triggerVersion = Number(doc.openVersion || 1);
    if (!isFinite(triggerVersion) || triggerVersion < 1) triggerVersion = 1;

    var runId = "agent_runs::guest-recovery::" + meta.id + "::v" + triggerVersion;

    // Idempotency guard
    if (dst[runId]) return;

    var now = new Date().toISOString();
    dst[runId] = {
      docType: "agent_run",
      runId: runId,
      agentType: "guest-recovery",
      guestId: String(doc.guestId),
      incidentId: meta.id,
      query: String(doc.description || ""),
      status: "pending",
      triggerVersion: triggerVersion,
      sourceStatus: String(doc.status),
      retryCount: 0,
      startedAt: now,
      createdAt: now,
      updatedAt: now
    };
  } catch (e) {
    log("OnUpdate error for incident " + meta.id + ": " + e);
  }
}

function OnDelete(meta, options) {
  // No-op: do not delete agent runs when source incident is deleted
}
```

**Idempotency model:** Document key is deterministic (`{incidentId}::v{openVersion}`). Re-saves of the same `openVersion` produce no duplicate runs. Increment `openVersion` only when an incident re-opens after resolution.

**Testing:** Insert an incident with `status: "open"` via Capella Query Workbench, then query `voyageops.agent.agent_runs` to confirm a single `pending` document was created.


---

## 7. Agent Seed Data

Before the agent service can generate quality proposals, run the seed script to populate the retrieval collections with embedded domain knowledge:

```bash
npx tsx scripts/seed-agent-data.ts
```

Requires `OPENAI_API_KEY` (or `OPENAI_KEY`) and all Couchbase connection env vars.

### What it seeds

| Collection | Documents | Key format | Embedding |
|---|---|---|---|
| `action_catalog` | 10 | `action_catalog::{actionId}` | Yes (1536-dim) |
| `playbooks` | 6 | `playbooks::{playbookId}` | Yes (1536-dim) |
| `policy_rules` | 6 | `policy_rules::{ruleId}` | No |

The script is idempotent — runs `upsert` so re-running is safe.

-- Agent scope GSI indexes (queried by agent service)
CREATE INDEX voAgent_action_proposals_status_createdAt 
ON voyageops.agent.action_proposals(status, createdAt DESC);
CREATE INDEX voAgent_action_executions_proposalId 
ON voyageops.agent.action_executions(proposalId, updatedAt DESC);
CREATE INDEX voAgent_outcomes_guest_incident 
ON voyageops.agent.outcomes(guestId, incidentId, measuredAt DESC);

-- Agent scope Vector Indexes (for semantic retrieval)
CREATE VECTOR INDEX voAgent_vector_action_catalog_embedding
ON voyageops.agent.action_catalog(embedding VECTOR)
WITH {"dimension": 1536, "similarity": "L2", "description": "IVF,SQ8"};

CREATE VECTOR INDEX voAgent_vector_playbooks_embedding
ON voyageops.agent.playbooks(embedding VECTOR)
WITH {"dimension": 1536, "similarity": "L2", "description": "IVF,SQ8"};

CREATE VECTOR INDEX voAgent_vector_outcomes_embedding
ON voyageops.agent.outcomes(embedding VECTOR)
WITH {"dimension": 1536, "similarity": "L2", "description": "IVF,SQ8"};

-- Eventing metadata collection (do NOT index)
-- voyageops.eventing.sysdata is managed internally by Capella Eventing (no application index needed)


## 8. Integration Points by File

### `src/data/mockData.ts` — Data Layer
| Mock Export | Couchbase Collection | Query Pattern |
|---|---|---|
| `guests` | `voyageops.guests.guests` | SQL++ `SELECT * FROM` |
| `bookings` | `voyageops.guests.bookings` | SQL++ with `JOIN` on guestId |
| `incidents` | `voyageops.guests.incidents` | SQL++ filtered by status/severity |
| `excursions` | `voyageops.excursions.excursions` | SQL++ filtered by status |
| `venues` | `voyageops.operations.venues` | SQL++ or Sub-Document API for IoT |
| `agentRecommendations` | `voyageops.intelligence.recommendations` | SQL++ filtered by agentType |
| `shipInfo` | `voyageops.intelligence.ship_info` | KV `get("current")` |
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

### `src/components/AgentChat.tsx` — NLP Chat Interface (Live)

The `guest-recovery` agent type now calls the live vector endpoint:
```typescript
// IMPLEMENTED: POST /api/agent-query
// 1. User sends query
// 2. Frontend calls api.agentQuery(query, "guest-recovery")
// 3. Backend: resolveQueryEmbedding() → OpenAI or corpus fallback
// 4. Backend: searchIncidentsByVectorIndexes() → APPROX_VECTOR_DISTANCE over 3 GSI vector indexes
// 5. Response includes ranked incidents + metadata (retrievalMode, indexesUsed, embeddingSource)
// 6. AgentChat renders Vector Mode badge showing live index status
```

Environment variables required:
```
OPENAI_API_KEY=sk-...        # Required for embedding
OPENAI_EMBEDDING_MODEL=text-embedding-3-small  # Optional override
CB_VECTOR_INDEX_CATEGORY=    # Optional: override default index name
CB_VECTOR_INDEX_TYPE=        # Optional: override default index name
CB_VECTOR_INDEX_DESC=        # Optional: override default index name
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

## 9. Migration Steps

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

## 10. Query Reference

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

## 11. AI & NLP Integration

> **Status:** Data infrastructure complete. RAG pipeline not yet implemented.

### What is in place

The following foundation is ready for a RAG pipeline to be built on top of:

- **Vector indexes** on `voyageops.guests.incidents` (3 GSI vector indexes, 1536-dim, L2)
- **Agent scope vector indexes** on `action_catalog`, `playbooks`, `outcomes` (seeded, indexed)
- **Embedding generation** via OpenAI `text-embedding-3-small` (`getQueryEmbedding()` in `routes.ts`)
- **Semantic retrieval** via `APPROX_VECTOR_DISTANCE` SQL++ (`searchIncidentsByVectorIndexes()`)
- **Seeded retrieval context** — action catalog, playbooks, and policy rules with embeddings loaded
- **Capella Eventing trigger** — new open incidents create pending `agent_runs` automatically

### What is not yet implemented

- LLM `chat/completions` call (no GPT-4/Claude prompt assembly or response generation)
- Context window preparation (incident + actions + playbooks + guest profile assembled into prompt)
- `action_proposals` generation from LLM output
- Approval queue wired to real `action_proposals` documents (currently uses mock `recommendations`)
- `action_executions` write-back from approved proposals
- `outcomes` document generation post-execution

### Planned RAG Flow (when implemented)

```
User Query
    ↓
  Embed query (OpenAI text-embedding-3-small)           ← EXISTS
    ↓
  APPROX_VECTOR_DISTANCE over incidents                 ← EXISTS
    ↓
  APPROX_VECTOR_DISTANCE over action_catalog            ← READY (index + data seeded)
    ↓
  APPROX_VECTOR_DISTANCE over playbooks                 ← READY (index + data seeded)
    ↓
  Fetch matching policy_rules (SQL++ filter)            ← READY (data seeded)
    ↓
  Assemble prompt: guest context + incidents +          ← NOT YET IMPLEMENTED
  matched actions + playbook + policy constraints
    ↓
  POST to OpenAI chat/completions (GPT-4o)              ← NOT YET IMPLEMENTED
    ↓
  Parse structured proposal from LLM response           ← NOT YET IMPLEMENTED
    ↓
  Write action_proposals → approval queue               ← NOT YET IMPLEMENTED
```

### References (for when RAG is implemented)

- OpenAI chat completions: https://platform.openai.com/docs/api-reference/chat
- Capella Vector Search: https://docs.couchbase.com/cloud/vector-search/vector-search.html
- Capella AI Services: https://docs.couchbase.com/ai/get-started/intro.html

---

## 12. Real-Time Features

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

## 13. Security & Connection Management

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
