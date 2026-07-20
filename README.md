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
- Couchbase Agent Catalog (`agentc`) — versioned prompt/tool catalog + activity logging

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
CB_PLAYBOOK_VECTOR_INDEX=voAgent_vector_playbooks_embedding
CB_VECTOR_INDEX_OUTCOMES=
GUEST_RECOVERY_USE_AGENTC=false
# ${VAR} interpolation works here, so you can reuse your cluster credentials directly:
AGENT_CATALOG_CONN_STRING=${COUCHBASE_ENDPOINT}
AGENT_CATALOG_USERNAME=${COUCHBASE_USER}
AGENT_CATALOG_PASSWORD=${COUCHBASE_PASSWORD}
AGENT_CATALOG_BUCKET=voyageops
AGENT_CATALOG_CATALOG=.agent-catalog
AGENT_CATALOG_ACTIVITY=.agent-activity
```

**Before first setup:** Whitelist your laptop IP (Capella), create a read-write user on the `voyageops` bucket, and ensure the bucket exists. Eventing deploy often needs **cluster admin** credentials in `.env` (or `COUCHBASE_CLI_*` for CLI mode).

---

## First-time Setup

### 1. Install dependencies

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r backend/python/guest_recovery/requirements.txt
```

### 2. Automated cluster setup (from your laptop)

Runs against the cluster in `.env`. **Vector indexes are created only after seed data** (embeddings must exist first).

**Full pipeline** (schema → Eventing → seed → vector indexes):

```sh
npm run demo:setup-cluster
```

On **Capella**, Phase 2 (Eventing REST on port 8096) is skipped automatically — deploy functions in the Capella UI ([docs/README.manual-setup.md](docs/README.manual-setup.md) section 5), then run `npm run demo:setup-cluster -- --seed-only` if the full pipeline stopped after schema.

**Step by step:**

```sh
npm run demo:setup-schema          # scopes, collections, primary indexes
npm run demo:setup-eventing        # deploy incidentTimestamps + guest_recovery_trigger
# seed data (existing scripts — same as manual flow)
npm run demo:load-guests
npm run demo:load-bookings
npx tsx scripts/seed-action-catalog.ts
npx tsx scripts/seed-agent-data.ts
npx tsx scripts/seed-intelligence-data.ts
npx tsx scripts/seed-excursions-data.ts
npx tsx scripts/demo-reset-incidents.ts --seed-if-empty
npm run demo:setup-vector-indexes  # AFTER seeds — GSI + Search hybrid indexes (worker playbooks)
```

**Eventing on self-managed Couchbase** (requires `couchbase-cli` on PATH):

```sh
npm run demo:setup-eventing -- --driver=cli
```

**Other flags:**

```sh
npx tsx scripts/setup-cluster.ts --schema-only
npx tsx scripts/setup-cluster.ts --eventing-only
npx tsx scripts/setup-cluster.ts --seed-only
npx tsx scripts/setup-cluster.ts --vector-indexes-only
npx tsx scripts/setup-cluster.ts --skip-seed    # schema + eventing + vector only
npx tsx scripts/setup-cluster.ts --skip-eventing  # skip Eventing (self-managed clusters)
npx tsx scripts/setup-cluster.ts --dry-run      # print SQL / Eventing actions without executing
```

After vector index setup, confirm `.env` index names (printed by `demo:setup-vector-indexes`):

```
CB_VECTOR_INDEX_CATEGORY=voGuestIncident_vector_category_incidents
CB_VECTOR_INDEX_TYPE=voGuestIncident_vector_type_incidents
CB_VECTOR_INDEX_DESC=voGuestIncident_vector_desc_incidents
CB_PLAYBOOK_VECTOR_INDEX=voAgent_vector_playbooks_embedding
CB_VECTOR_INDEX_OUTCOMES=voAgent_vector_outcomes_embedding
```

On **Capella**, the FTS index may appear as `voyageops.agent.voAgent_vector_playbooks_embedding`; keep the short name in `.env` — the worker resolves scoped Search index names automatically.

### 3. Agent Catalog setup (agentc) — optional

The Guest Recovery worker can load its system prompt from the [Couchbase Agent Catalog](https://docs.couchbase.com/ai/build/integrate-agent-with-catalog.html) instead of the built-in default, which lets prompt/tool changes be versioned and their usage logged in Couchbase. `agentc` reuses your cluster credentials and, on publish, creates a `voyageops.agent_catalog` scope.

```sh
npm run demo:setup-agentc
```

This runs `agentc init`, `agentc index backend/python/guest_recovery`, and `agentc publish` against `AGENT_CATALOG_BUCKET`. Requirements:

- `agentc` installed in `.venv` (already included via `backend/python/guest_recovery/requirements.txt`)
- A **clean git working tree** — `agentc index` refuses to run with uncommitted changes
- `AGENT_CATALOG_CONN_STRING`, `AGENT_CATALOG_USERNAME`, `AGENT_CATALOG_PASSWORD` set in `.env` — `.env` supports `${VAR}` interpolation, so you can reuse your cluster credentials directly, e.g. `AGENT_CATALOG_CONN_STRING=${COUCHBASE_ENDPOINT}`
- For `couchbases://` connections, `AGENT_CATALOG_CONN_ROOT_CERTIFICATE` falls back to the `certifi` bundle automatically (Capella certs are publicly signed), so it's only needed for a self-managed cluster with a private CA

Once published, set `GUEST_RECOVERY_USE_AGENTC=true` in `.env` and restart the worker to have it pull `guest_recovery_system_prompt` from the catalog. Leave it `false` to keep using the built-in default prompt.

**Auto-sync on commit (optional):** `agentc init --add-hook-for <dir>` can generate a `.git/hooks/post-commit` hook that re-indexes and publishes the catalog after every commit, so prompt/tool changes stay in sync automatically. Git hooks live under `.git/hooks/`, which **is not tracked by git** — a fresh clone won't have this hook even if a previous environment set one up, and `npm run demo:setup-agentc` does not install it (it only runs `agentc init` without `--add-hook-for`). If you want it, create `.git/hooks/post-commit` yourself:

```sh
#!/bin/sh
# File generated by agent-catalog (agentc).
# agentc lives in the project venv, not on PATH, so resolve it explicitly.

REPO_ROOT="$(git rev-parse --show-toplevel)"
AGENTC="$REPO_ROOT/.venv/bin/agentc"

"$AGENTC" index "$REPO_ROOT/backend/python/guest_recovery"
"$AGENTC" publish tools prompts
```

```sh
chmod +x .git/hooks/post-commit
```

This resolves `agentc` via the venv explicitly (the bare `agentc` command isn't on `PATH` outside it) and always points `index` at `backend/python/guest_recovery` (agentc's own generated hook omits the source directory unless you pass one to `--add-hook-for`, and — being a plain append-only script — won't fix itself if you re-run `agentc init` later). Requires the same clean-working-tree precondition as `agentc index` above.

### 4. Manual setup (archived)

Original Query Workbench and Capella UI instructions are preserved in **[docs/README.manual-setup.md](docs/README.manual-setup.md)**.

Individual seed/load scripts remain available and are **not** replaced by the orchestrator—they are invoked as-is.

---

## Running the Demo

The demo requires **three processes** running concurrently, each in its own terminal:

### Terminal 1 — API + frontend (recommended)

```sh
npm run dev
```

This starts the Express API on **http://localhost:5173** and Vite on **http://localhost:8080** (UI proxies `/api` to the API).

Or run them separately:

```sh
npm run dev:api    # Terminal 1 — API only
npm run dev:vite   # Terminal 2 — Vite only
```

Open the app at **http://localhost:8080**.

On **Guest Recovery**, the center column (Top-10 guest queue) and the right column (chat-focused incident) can both list the same worker proposal when the selected guest’s open incident matches the incident you are viewing in chat. Each column uses the same approval control; approving either updates the same Couchbase proposal document.

### Terminal 2 — (When ready) Python worker

```sh
npm run demo:worker
```

> The worker will refuse to start if another instance is already running (PID guard).
> The Guest Recovery Agent chat in the UI shows live worker activity as it processes runs.

---

## Demo Reset

To reset the demo to a clean starting state between runs:

```sh
# Reloads all incidents from data, clears agent runtime docs, requeues open incidents.
npm run demo:reset-incidents
```

Then start the worker (`npm run demo:worker`) to begin processing. Or combine both:

```sh
npm run demo:day
```

First-time seed only (empty incidents collection): `npx tsx scripts/demo-reset-incidents.ts --seed-if-empty`

---

## All npm Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite frontend dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit tests |
| `npm run demo:setup-cluster` | Full cluster setup: schema → eventing → seed → vector indexes |
| `npm run demo:setup-agentc` | Init/index/publish the Agent Catalog (`agentc`) — requires a clean git tree |
| `npm run demo:setup-schema` | Scopes, collections, primary indexes only |
| `npm run demo:setup-eventing` | Deploy Eventing functions (REST; use `-- --driver=cli` for couchbase-cli) |
| `npm run demo:setup-vector-indexes` | GSI + Search hybrid vector indexes (run **after** seed data) |
| `npm run demo:setup-search-indexes` | Search hybrid indexes only (playbooks; after `seed-agent-data`) |
| `npm run demo:load-guests` | Load guest backup data |
| `npm run demo:load-bookings` | Load booking backup data |
| `npm run demo:reset-incidents` | Full incident reload (`--all --requeue`) + clear agent runtime docs |
| `npm run demo:worker` | Start the Guest Recovery Agent Python worker |
| `npm run demo:day` | Full incident reset + requeue, then start worker |
| `npx tsx scripts/seed-action-catalog.ts` | Seed / refresh action catalog with embeddings |
| `npx tsx scripts/seed-agent-data.ts` | Seed playbooks and policy rules |
| `npx tsx scripts/seed-intelligence-data.ts` | Seed recommendations, timeline, KPIs, ship info |
| `npx tsx scripts/seed-excursions-data.ts` | Seed excursions and guest/booking data |
| `npm run demo:load-incidents-for-recovery -- --file data/my-incidents.ndjson` | Load incidents from NDJSON file |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full system design, data model, and agent pipeline documentation.

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for Couchbase integration details and Eventing handler reference.
