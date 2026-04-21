# VoyageOps AI — Acme Cruise Line

AI-powered operational intelligence platform for cruise line operations. Demonstrates how operational AI agents can use transactional and operational data to improve cruise-line operations.

## Agents

- **Guest Service Recovery Agent** — Detect service failures, correlate guest data, and recommend recovery actions
- **Port & Excursion Disruption Agent** — Monitor itinerary disruptions, assess impact, and coordinate rebooking
- **Onboard Operations Optimization Agent** — Monitor venue demand, staffing, and maintenance to optimize guest experience

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
CB_PLAYBOOK_VECTOR_INDEX=
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
npm tsx scripts/load-guests-backup.ts

# Seed booking data
npm tsx scripts/load-bookings-backup.ts

# Seed action catalog (generates OpenAI embeddings — takes ~2 min)
npx tsx scripts/seed-action-catalog.ts

# Seed playbooks, policy rules
npx tsx scripts/seed-agent-data.ts

# Seed intelligence data (recommendations, timeline, KPIs, ship info)
npx tsx scripts/seed-intelligence-data.ts

# Seed excursions and mock guest/booking data
npx tsx scripts/seed-excursions-data.ts

# Seed incident data - Key for Guest Recovery Agent demo
## first time load use
# The command runs demo-reset-incidents.ts:1, and on first run it does two things:
# **If voyageops.guests.incidents is empty**, it loads from data/voyageops.guests.incidents
# The embedding values for description, type and vategory are already in this file to speed up loading of data
npx tsx scripts/demo-reset-incidents

# **If voyageops.guests.incidents has documents**, then it resets all incidents to **open** status
# If you also want agent runs queued immediately for those incidents, use:
npx tsx scripts/demo-reset-incidents.ts --requeue

```

### 4. Set up Couchbase vector search indexes for Guest Recovery Agent

```sh
.venv/bin/python backend/python/guest_recovery/setup_search_index.py
```

## Update .env with vector index names 
CB_PLAYBOOK_VECTOR_INDEX=voAgentPlaybookOpenAI_vectorIndex
CB_VECTOR_INDEX_CATEGORY=voGuestIncident_vector_category_incidents
CB_VECTOR_INDEX_TYPE=voGuestIncident_vector_type_incidents
CB_VECTOR_INDEX_DESC=voGuestIncident_vector_desc_incidents


### 5. Create and deploy the Eventing function

The Guest Recovery flow depends on Capella Eventing to create `agent_runs` documents when incidents are `open`.

1. Create Eventing metadata scope/collection in Query Workbench:

```sql
-- Run from database/prepForEventing.sql
CREATE SCOPE voyageops.eventing;
CREATE COLLECTION voyageops.eventing.sysdata;
```

2. In Capella, open **Eventing** and create a new function:

- Function name: `guest_recovery_trigger`
- Source collection: `voyageops.guests.incidents`
- Metadata collection: `voyageops.eventing.sysdata`
- Language: JavaScript

3. Add bucket binding:

- Alias: `dst`
- Collection: `voyageops.agent.agent_runs`
- Access: Read + Write

- Alias: `src`
- Collection: `voyageops.guests.incidents`
- Access: Read

4. Paste the handler code from `database/eventing.guestIncidentTrigger.js`.

5. Deploy and resume the function.

6. Validate with a quick query:

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
# Resets all incidents to "open" and clears agent_runs / action_proposals / action_executions.
# Does NOT enqueue agent runs — incidents are reset but the agent hasn't processed them yet.
npm run demo:reset-incidents
```

# After reset, Couchbase Eventing (`database/eventing.guestIncidentTrigger.js`) will automatically
# create `agent_runs` docs as incidents are opened. To also enqueue pending runs immediately, use:

```sh
npx tsx scripts/demo-reset-incidents.ts --requeue
```
Then start the worker (`npm run demo:worker`) to begin processing.

---

## All npm Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite frontend dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint | TypeScript/JavaScript mistakes ESLint can detect React Hooks misuse & React Fast Refresh export-pattern issues
| `npm test` | Run Vitest unit tests |
| `npm run demo:reset-incidents` | Reset incidents + clear all agent runtime docs |
| `npm run demo:worker` | Start the Guest Recovery Agent Python worker |
| `npm run demo:day` | Reset incidents then start worker (combined shortcut) |
| `npx tsx scripts/seed-action-catalog.ts` | Seed / refresh action catalog with embeddings |
| `npx tsx scripts/seed-agent-data.ts` | Seed playbooks and policy rules |
| `npx tsx scripts/seed-intelligence-data.ts` | Seed recommendations, timeline, KPIs, ship info |
| `npx tsx scripts/seed-excursions-data.ts` | Seed excursions and guest/booking data |

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full system design, data model, and agent pipeline documentation.
