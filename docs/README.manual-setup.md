> Snapshot of setup docs before cluster automation scripts; kept for manual Query Workbench / Capella UI steps.

# VoyageOps AI — Acme Cruise Line

AI-powered operational intelligence platform for cruise line operations. Demonstrates how operational AI agents can use transactional and operational data to improve cruise-line operations.

## Agent

- **Guest Recovery Agent** — Detect service failures, correlate guest data, recommend recovery actions, and run live LLM chat plus the Python worker (Couchbase + OpenAI)

## Tech Stack

- Vite + React + TypeScript
- shadcn/ui + Tailwind CSS
- Recharts
- Couchbase (data + vector search)
- OpenAI (embeddings + LLM reasoning)
- Python 3 (Guest Recovery Agent worker)

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| npm | 10+ |
| Python | 3.11+ |
| Couchbase cluster | `voyageops` bucket provisioned; Data, Query, Index, FTS, and Eventing services enabled |

Copy `.env.example` to `.env` and fill in all values before starting:

```sh
cp .env.example .env
```

Required environment variables:

```
COUCHBASE_ENDPOINT=
COUCHBASE_USER=
COUCHBASE_PASSWORD=
COUCHBASE_BUCKET=voyageops
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
CB_VECTOR_INDEX_CATEGORY=
CB_VECTOR_INDEX_TYPE=
CB_VECTOR_INDEX_DESC=
# Short FTS name; worker resolves Capella scoped names (e.g. voyageops.agent.voAgent_vector_playbooks_embedding)
CB_PLAYBOOK_VECTOR_INDEX=voAgent_vector_playbooks_embedding
```

---

## First-time Setup

### 1. Install Node dependencies

```sh
npm install
```

### 2. Create Python virtual environment

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/python/guest_recovery/requirements.txt
```

### 3. Seed the database

Run these **once** after provisioning your Couchbase cluster, whitelisting IP for Capella or cloud based clusters
and creating a read-write user for access to voyageops bucket if this is a brand new cluster and updating the .env
with connect credential values
(or any time you want to reset catalog/playbook data):

First, create scopes/collections/indexes in Query Workbench:
```sql
-- Core app scopes + collections + primary indexes
-- Run from database/core.scope.sql

-- Create incident document vector indexes
-- Run from database/incident.vector.indexes.sql

-- Agent scope + collections + primary indexes + vector indexes
-- Run from database/agent.scope.sql

-- Eventing metadata scope + collection
-- Run from database/prepForEventing.sql
```

Then run the seed scripts:

```sh
# Seed guest data
npx tsx scripts/load-guests-backup.ts

# Seed booking data
npx tsx scripts/load-bookings-backup.ts

# Seed action catalog (generates OpenAI embeddings — takes ~2 min)
npx tsx scripts/seed-action-catalog.ts

# Seed playbooks, policy rules
npx tsx scripts/seed-agent-data.ts

# Seed intelligence data (recommendations, timeline, KPIs, ship info)
npx tsx scripts/seed-intelligence-data.ts

# Seed excursions and mock guest/booking data
npx tsx scripts/seed-excursions-data.ts

# Seed incident data - Key for Guest Recovery Agent demo
# First-time load (when incidents collection is empty):
npx tsx scripts/demo-reset-incidents.ts --seed-if-empty

# Full reset (destructive) + reload from data/voyageops.guests.incidents:
npx tsx scripts/demo-reset-incidents.ts --all

# Requeue open incidents for the worker (often with --all):
npx tsx scripts/demo-reset-incidents.ts --all --requeue

```

### 4. Create vector indexes for Guest Recovery Agent

After seeding playbooks with embeddings:

```sh
npm run demo:setup-vector-indexes
```

This runs Query GSI indexes from `database/create.vector.indexes.sql` and deploys the Search hybrid index from `database/search-indexes/voAgent_vector_playbooks_embedding.json` (self-managed clusters only; Capella blocks laptop Search REST).

#### Capella: manual Search (FTS) index for playbooks

On Capella, import the playbook hybrid index in the UI (read-only JSON preview after upload is normal — close that panel, then **Create Index**):

1. **Search → Import Search Index** and upload [`database/search-indexes/voAgent_capella_import.json`](../database/search-indexes/voAgent_capella_import.json) (not the localhost REST file).
2. **Document filter:** none — type mapping targets `agent.playbooks` via `agent.playbooks.guest-recovery` (`agentType` field).
3. Wait until index status is **Ready** (scoped name is often `voyageops.agent.voAgent_vector_playbooks_embedding`).
4. Set `.env`:

```env
CB_PLAYBOOK_VECTOR_INDEX=voAgent_vector_playbooks_embedding
```

The worker resolves Capella scoped FTS names automatically when the short name is not listed. GSI vector index name stays the short name above.

If **Create Index** fails because a GSI already uses the same name on `agent` scope, either drop that GSI in Query → Indexes or create FTS under a different name and set `CB_PLAYBOOK_VECTOR_INDEX` to the scoped FTS name explicitly.

### Update .env with vector index names

```env
CB_PLAYBOOK_VECTOR_INDEX=voAgent_vector_playbooks_embedding
CB_VECTOR_INDEX_CATEGORY=voGuestIncident_vector_category_incidents
CB_VECTOR_INDEX_TYPE=voGuestIncident_vector_type_incidents
CB_VECTOR_INDEX_DESC=voGuestIncident_vector_desc_incidents
```

### 5. Create and deploy Eventing functions

The Guest Recovery flow uses two Capella Eventing handlers:
- `incidentTimestamps` to maintain incident timestamp fields.
- `guest_recovery_trigger` to create `agent_runs` documents when incidents are `open`.

1. Create Eventing metadata scope/collection in Query Workbench:

```sql
-- Run from database/prepForEventing.sql
CREATE SCOPE voyageops.eventing;
CREATE COLLECTION voyageops.eventing.sysdata;
```

2. In Capella, open **Eventing** and create function `incidentTimestamps` first:

- Function name: `incidentTimestamps`
- Source collection: `voyageops.guests.incidents`
- Metadata collection: `voyageops.eventing.sysdata`
- Language: JavaScript

3. Paste the handler code from `database/eventing.incidentTimestamps.js`.

4. Deploy and resume `incidentTimestamps`.

5. Create function `guest_recovery_trigger`:

- Function name: `guest_recovery_trigger`
- Source collection: `voyageops.guests.incidents`
- Metadata collection: `voyageops.eventing.sysdata`
- Language: JavaScript

6. Add bucket binding:

- Alias: `dst`
- Collection: `voyageops.agent.agent_runs`
- Access: Read + Write

- Alias: `src`
- Collection: `voyageops.guests.incidents`
- Access: Read

7. Paste the handler code from `database/eventing.guestIncidentTrigger.js`.

8. Deploy and resume `guest_recovery_trigger`.

9. Validate with a quick query:

```sql
SELECT status, COUNT(1) AS count
FROM voyageops.agent.agent_runs
GROUP BY status;
```

If Eventing is deployed correctly, resetting incidents to `open` will produce `pending` status documents in `agent_runs`.

---

## Running the Demo

The demo requires **three processes** running concurrently, each in its own terminal:

### Terminal 1 — API server

```sh
npx tsx src/api/server.ts
```

### Terminal 2 — Frontend dev server

```sh
npm run dev
```

The app is then available at **http://localhost:5173**.

On **Guest Recovery**, the center column (Top-10 guest queue) and the right column (chat-focused incident) can both list the same worker proposal when the selected guest’s open incident matches the incident you are viewing in chat. Each column uses the same approval control; approving either updates the same Couchbase proposal document.

### Terminal 3 — (When ready) Python worker

```sh
npm run demo:worker
```

> The worker will refuse to start if another instance is already running (PID guard).
> The Guest Recovery Agent chat in the UI shows live worker activity as it processes runs.
> As soon as you start this, 

---

## Demo Reset

To reset the demo to a clean starting state between runs:

```sh
# Reloads all incidents from data, clears agent_runs / proposals / executions, requeues open incidents.
npm run demo:reset-incidents
```

Or reset and start the worker in one step:

```sh
npm run demo:day
```

---

## All npm Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite frontend dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint | TypeScript/JavaScript mistakes ESLint can detect React Hooks misuse & React Fast Refresh export-pattern issues
| `npm test` | Run Vitest unit tests |
| `npm run demo:reset-incidents` | Full incident reload + requeue + clear agent runtime docs |
| `npm run demo:worker` | Start the Guest Recovery Agent Python worker |
| `npm run demo:day` | Full incident reset + requeue, then start worker |
| `npx tsx scripts/seed-action-catalog.ts` | Seed / refresh action catalog with embeddings |
| `npx tsx scripts/seed-agent-data.ts` | Seed playbooks and policy rules |
| `npx tsx scripts/seed-intelligence-data.ts` | Seed recommendations, timeline, KPIs, ship info |
| `npx tsx scripts/seed-excursions-data.ts` | Seed excursions and guest/booking data |
| `npm run demo:load-incidents-for-recovery -- --file data/my-incidents.ndjson` | Load specific 
|     incident doc contained in file data/my-incidents.ndjson

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full system design, data model, and agent pipeline documentation.
