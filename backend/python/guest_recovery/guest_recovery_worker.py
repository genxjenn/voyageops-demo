import json
import logging
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Mapping

import agentc
import couchbase.search as search
from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions, QueryOptions, SearchOptions
from couchbase.vector_search import VectorQuery, VectorSearch
from openai import OpenAI

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python_env import get_required_env, load_repo_env


class AgentWorkerError(Exception):
    def __init__(self, step: str, message: str):
        super().__init__(message)
        self.step = step
        self.message = message


LOGGER = logging.getLogger(__name__)

# Module-level caches: populated on first use and reused across all runs in the
# same worker process, avoiding repeated round-trips for data that doesn't change.
_verified_search_indexes: set[str] = set()
_policy_rules_cache: list[dict[str, Any]] | None = None
PLAYBOOK_SEARCH_SCOPE = "agent"


def _emit_worker_metric(metric_name: str, **fields: Any) -> None:
    try:
        payload = {"metric": metric_name, **fields}
        LOGGER.warning("guest_recovery_metric %s", json.dumps(payload, sort_keys=True))
    except Exception:
        # Never allow observability failures to affect runtime behavior.
        pass


@dataclass(frozen=True)
class Settings:
    couchbase_endpoint: str
    couchbase_user: str
    couchbase_password: str
    couchbase_bucket: str
    openai_api_key: str
    openai_model: str
    openai_embed_model: str
    playbook_index_name: str
    use_agentc: bool


@dataclass(frozen=True)
class ActionPolicyLoadResult:
    actions: list[dict[str, Any]]
    policies: list[dict[str, Any]]
    coverage_gap_reason: str | None = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_repo_env(REPO_ROOT)

    return Settings(
        couchbase_endpoint=get_required_env("COUCHBASE_ENDPOINT"),
        couchbase_user=get_required_env("COUCHBASE_USER"),
        couchbase_password=get_required_env("COUCHBASE_PASSWORD"),
        couchbase_bucket=os.getenv("COUCHBASE_BUCKET", "voyageops"),
        openai_api_key=get_required_env("OPENAI_API_KEY"),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        openai_embed_model=get_required_env("OPENAI_EMBEDDING_MODEL"),
        playbook_index_name=get_required_env("CB_PLAYBOOK_VECTOR_INDEX"),
        use_agentc=os.getenv("GUEST_RECOVERY_USE_AGENTC", "false").strip().lower() == "true",
    )


def create_cluster(settings: Settings) -> Cluster:
    auth = PasswordAuthenticator(settings.couchbase_user, settings.couchbase_password)
    return Cluster(settings.couchbase_endpoint, ClusterOptions(auth))


@lru_cache(maxsize=1)
def create_openai_client(settings: Settings) -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


@lru_cache(maxsize=1)
def get_agentc_catalog() -> agentc.Catalog:
    return agentc.Catalog()


class _NullSpan:
    """No-op stand-in for agentc.Span, used when GUEST_RECOVERY_USE_AGENTC is off (or Agent Catalog
    is unreachable) so call sites can log unconditionally instead of branching on settings.use_agentc."""

    def __enter__(self) -> "_NullSpan":
        return self

    def __exit__(self, *_exc: Any) -> bool:
        return False

    def new(self, *_args: Any, **_kwargs: Any) -> "_NullSpan":
        return self

    def log(self, *_args: Any, **_kwargs: Any) -> None:
        pass


def _get_root_span(settings: Settings, run_id: str, incident_id: str, guest_id: str) -> Any:
    """One root Span per agent run, named/sessioned by run_id so Capella's Agent Tracer groups a
    run's tool calls and LLM reasoning together. Falls back to a no-op span on any failure so
    tracing can never break a run."""
    if not settings.use_agentc:
        return _NullSpan()

    try:
        catalog = get_agentc_catalog()
        return catalog.Span(
            name="guest_recovery_run",
            session=run_id,
            state={"incidentId": incident_id, "guestId": guest_id},
        )
    except Exception as error:
        LOGGER.warning("Agent Catalog span init failed; continuing without activity tracing: %s", error)
        return _NullSpan()


def _traced_tool_call(
    span: Any,
    tool_name: str,
    tool_args: Mapping[str, Any],
    fn: Callable[..., Any],
    *args: Any,
    result_summary: Callable[[Any], Any] | None = None,
    **kwargs: Any,
) -> Any:
    """Invoke `fn` inside a child span, logging a ToolCall/ToolResult pair around it so the
    invocation shows up in Agent Catalog activity. `result_summary`, if given, controls what gets
    logged as the result (e.g. a length instead of a raw embedding vector)."""
    tool_call_id = uuid.uuid4().hex
    with span.new(name=tool_name) as tool_span:
        tool_span.log(
            content=agentc.span.ToolCallContent(
                tool_name=tool_name,
                tool_args=dict(tool_args),
                tool_call_id=tool_call_id,
            )
        )
        try:
            result = fn(*args, **kwargs)
        except Exception as error:
            tool_span.log(
                content=agentc.span.ToolResultContent(
                    tool_call_id=tool_call_id,
                    tool_result=str(error),
                    status="error",
                )
            )
            raise

        tool_span.log(
            content=agentc.span.ToolResultContent(
                tool_call_id=tool_call_id,
                tool_result=result_summary(result) if result_summary else result,
            )
        )
        return result


_DEFAULT_SYSTEM_MESSAGE = (
    "You are the VoyageOps Guest Recovery Agent. "
    "Select one approved recovery action from the eligible catalog and explain why it is the best fit. "
    "Also provide interactive alternatives and follow-up prompts an operator can use immediately. "
    "Strictly adhere to policy rules. "
    "Return valid JSON only."
)


def _resolve_system_message(settings: Settings) -> str:
    if not settings.use_agentc:
        return _DEFAULT_SYSTEM_MESSAGE

    try:
        catalog = get_agentc_catalog()
        result = catalog.find(kind="prompt", name="guest_recovery_system_prompt")
    except Exception as error:
        raise AgentWorkerError("agentc_prompt", f"Unable to reach Agent Catalog for prompt lookup: {error}") from error

    if result is None:
        raise AgentWorkerError(
            "agentc_prompt",
            "Agent Catalog has no published 'guest_recovery_system_prompt' — run `npm run demo:setup-agentc`.",
        )

    content = result.content
    if not isinstance(content, str) or not content.strip():
        raise AgentWorkerError("agentc_prompt", "Agent Catalog prompt 'guest_recovery_system_prompt' has no text content")

    return content.strip()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _agent_collections(cluster: Cluster, bucket_name: str) -> dict[str, Any]:
    bucket = cluster.bucket(bucket_name)
    scope = bucket.scope("agent")
    return {
        "agent_runs": scope.collection("agent_runs"),
        "action_proposals": scope.collection("action_proposals"),
    }


def _get_document(collection: Any, document_id: str) -> dict[str, Any]:
    try:
        result = collection.get(document_id)
    except Exception as error:
        raise AgentWorkerError("load_run", f"Unable to load document {document_id}: {error}") from error

    try:
        return dict(result.content_as[dict])
    except Exception as error:
        raise AgentWorkerError("load_run", f"Document {document_id} did not contain a JSON object") from error


def _merge_and_upsert(
    collection: Any,
    document_id: str,
    current: Mapping[str, Any],
    updates: Mapping[str, Any],
    *,
    step: str,
) -> None:
    merged = dict(current)
    merged.update(updates)
    try:
        collection.upsert(document_id, merged)
    except Exception as error:
        raise AgentWorkerError(step, f"Unable to update run document {document_id}: {error}") from error


def _normalize_run_document(agent_run_or_id: str | Mapping[str, Any], agent_runs_collection: Any) -> tuple[str, dict[str, Any]]:
    if isinstance(agent_run_or_id, str):
        run_document = _get_document(agent_runs_collection, agent_run_or_id)
        run_id = agent_run_or_id
    else:
        run_document = dict(agent_run_or_id)
        run_id = str(run_document.get("runId") or run_document.get("agentRunId") or "")
        if not run_id:
            raise AgentWorkerError("load_run", "agent run document is missing runId")

    incident_id = run_document.get("incidentId")
    guest_id = run_document.get("guestId")
    if not incident_id or not guest_id:
        raise AgentWorkerError("load_run", "agent run is missing incidentId or guestId")

    run_document.setdefault("runId", run_id)
    return run_id, run_document


def _update_run_status(
    agent_runs_collection: Any,
    run_id: str,
    current_run: Mapping[str, Any],
    *,
    status: str,
    step: str,
    error_message: str | None = None,
    proposal_id: str | None = None,
) -> dict[str, Any]:
    timestamp = _utc_now_iso()
    updates: dict[str, Any] = {
        "status": status,
        "updatedAt": timestamp,
        "lastProcessedStep": step,
    }

    if status == "started":
        updates.setdefault("startedAt", timestamp)
    if status == "completed":
        updates["completedAt"] = timestamp
    if error_message:
        updates["lastError"] = {
            "step": step,
            "message": error_message,
            "updatedAt": timestamp,
        }
    if proposal_id:
        updates["proposalId"] = proposal_id

    _merge_and_upsert(agent_runs_collection, run_id, current_run, updates, step=step)
    merged = dict(current_run)
    merged.update(updates)
    return merged


def _fetch_incident_context(cluster: Cluster, incident_id: str) -> dict[str, Any]:
    context_query = """
    SELECT META(i).id AS incidentId,
           i.guestId,
           i.description,
           i.severity,
           i.category,
           i.type,
           i.status,
                     i.vector_desc_incidents,
           g.loyaltyTier,
           g.onboardSpend,
           (
             SELECT RAW COUNT(1)
             FROM voyageops.guests.incidents recent
             WHERE recent.guestId = i.guestId
               AND recent.status = "closed"
               AND recent.createdAt > DATE_ADD_STR(NOW_STR(), -3, "day")
           )[0] AS recentIncidents
    FROM voyageops.guests.incidents i
    JOIN voyageops.guests.guests g ON i.guestId = META(g).id
    WHERE META(i).id = $incidentId
    LIMIT 1
    """

    try:
        result = cluster.query(
            context_query,
            QueryOptions(named_parameters={"incidentId": incident_id}),
        )
        rows = list(result.rows())
    except Exception as error:
        raise AgentWorkerError("query_context", f"Unable to query incident context: {error}") from error

    if not rows:
        raise AgentWorkerError("query_context", f"No incident context found for incident {incident_id}")

    return dict(rows[0])


@agentc.catalog.tool
def _analyze_guest_sentiment(cluster: Cluster, incident_id: str, description: str) -> str | None:
    """Run Couchbase's ai_sentiment AI Function over the incident description and persist the
    result onto the incident document as guestSentiment. Best-effort: if AI Functions aren't
    enabled/reachable on this cluster, logs a warning and returns None instead of failing the run."""
    query = """
    UPDATE voyageops.guests.incidents AS i
    SET i.guestSentiment = default:ai_sentiment({"text": $description, "temperature": 0.3, "max_tokens": 100})[0].response,
        i.updatedAt = $now
    WHERE META(i).id = $incidentId OR i.incidentId = $incidentId
    RETURNING i.guestSentiment
    """

    try:
        result = cluster.query(
            query,
            QueryOptions(
                named_parameters={"description": description, "incidentId": incident_id, "now": _utc_now_iso()}
            ),
        )
        rows = list(result.rows())
    except Exception as error:
        LOGGER.warning("ai_sentiment analysis skipped for incident %s: %s", incident_id, error)
        return None

    sentiment = rows[0].get("guestSentiment") if rows else None
    return str(sentiment) if sentiment else None


@agentc.catalog.tool
def _create_incident_embedding(client: OpenAI, settings: Settings, description: str) -> list[float]:
    """Create an OpenAI embedding vector for an incident description, for playbook vector search."""
    try:
        embedding_response = client.embeddings.create(
            input=description,
            model=settings.openai_embed_model,
        )
    except Exception as error:
        raise AgentWorkerError("embedding", f"Unable to create embedding: {error}") from error

    try:
        return list(embedding_response.data[0].embedding)
    except Exception as error:
        raise AgentWorkerError("embedding", "Embedding response did not include a usable vector") from error


def _extract_incident_vector_from_context(context: Mapping[str, Any]) -> list[float] | None:
    vector = context.get("vector_desc_incidents")
    if not isinstance(vector, list) or not vector:
        return None

    normalized: list[float] = []
    for value in vector:
        if isinstance(value, (int, float)):
            normalized.append(float(value))
        else:
            return None

    return normalized if normalized else None


def _normalize_incident_type_key(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-").replace(" ", "-")


def _find_playbook_id_from_context(cluster: Cluster, context: Mapping[str, Any]) -> str | None:
    incident_type = _normalize_incident_type_key(context.get("type"))
    severity = str(context.get("severity") or "").strip().lower()
    loyalty_tier = str(context.get("loyaltyTier") or "").strip().lower()

    if not incident_type or not severity:
        return None

    query = """
    SELECT META(p).id AS playbookId
    FROM voyageops.agent.playbooks p
    WHERE p.active = true
      AND LOWER(REPLACE(REPLACE(TRIM(p.incidentType), " ", "-"), "_", "-")) = $incidentType
        AND (
            (IS_STRING(p.severity) AND LOWER(TRIM(p.severity)) = $severity)
            OR (
                IS_ARRAY(p.severity)
                AND ANY sev IN p.severity SATISFIES LOWER(TRIM(sev)) = $severity END
            )
            )
      AND (
            (IS_STRING(p.loyaltyTier) AND LOWER(TRIM(p.loyaltyTier)) IN ["any", $loyaltyTier])
            OR (
                IS_ARRAY(p.loyaltyTier)
                AND ANY tier IN p.loyaltyTier SATISFIES LOWER(TRIM(tier)) IN ["any", $loyaltyTier] END
            )
          )
    ORDER BY CASE
      WHEN IS_STRING(p.loyaltyTier) AND LOWER(TRIM(p.loyaltyTier)) = $loyaltyTier THEN 0
      WHEN IS_ARRAY(p.loyaltyTier) AND ANY tier IN p.loyaltyTier SATISFIES LOWER(TRIM(tier)) = $loyaltyTier END THEN 0
      ELSE 1
    END
    LIMIT 1
    """

    try:
        result = cluster.query(
            query,
            QueryOptions(
                named_parameters={
                    "incidentType": incident_type,
                    "severity": severity,
                    "loyaltyTier": loyalty_tier,
                }
            ),
        )
        rows = list(result.rows())
    except Exception as error:
        raise AgentWorkerError("playbook_lookup", f"Unable to resolve playbook by incident context: {error}") from error

    if not rows:
        return None

    playbook_id = str(rows[0].get("playbookId") or "").strip()
    return playbook_id or None


def _list_search_index_names(cluster: Cluster) -> list[str]:
    try:
        indexes = cluster.search_indexes().get_all_indexes()
        return sorted(idx.name for idx in indexes)
    except Exception as error:
        LOGGER.debug("search_indexes inspection failed: %s", error)
        return []


def _resolve_playbook_search_index_name(
    configured_name: str,
    available_indexes: list[str],
    bucket_name: str,
) -> str | None:
    """Map CB_PLAYBOOK_VECTOR_INDEX to the name the cluster exposes (scoped on Capella 7.6+)."""
    if configured_name in available_indexes:
        return configured_name

    scoped = f"{bucket_name}.{PLAYBOOK_SEARCH_SCOPE}.{configured_name}"
    if scoped in available_indexes:
        return scoped

    suffix = f".{configured_name}"
    candidates = [name for name in available_indexes if name.endswith(suffix)]
    if not candidates:
        return None

    preferred_prefix = f"{bucket_name}.{PLAYBOOK_SEARCH_SCOPE}."
    for name in candidates:
        if name.startswith(preferred_prefix):
            return name
    return candidates[0] if len(candidates) == 1 else None


def _find_playbook_id_via_gsi(
    cluster: Cluster,
    index_name: str,
    incident_vector: list[float],
) -> str:
    query = f"""
    SELECT META(p).id AS playbookId,
           APPROX_VECTOR_DISTANCE(p.embedding, $vector, "L2") AS distance
    FROM voyageops.agent.playbooks p
    USE INDEX (`{index_name}` USING GSI)
    WHERE p.active = true
      AND p.embedding IS NOT MISSING
    ORDER BY distance ASC
    LIMIT 1
    """

    try:
        result = cluster.query(
            query,
            QueryOptions(named_parameters={"vector": incident_vector}),
        )
        rows = list(result.rows())
    except Exception as error:
        raise AgentWorkerError("playbook_search", f"Playbook GSI vector search failed: {error}") from error

    if not rows:
        raise AgentWorkerError("playbook_search", "No matching playbook found for incident (GSI vector)")

    playbook_id = str(rows[0].get("playbookId") or "").strip()
    if not playbook_id:
        raise AgentWorkerError("playbook_search", "GSI vector search did not return a playbook id")
    _ensure_playbook_embedding_is_valid(cluster, playbook_id)
    return playbook_id


def _ensure_playbook_embedding_is_valid(cluster: Cluster, playbook_id: str) -> None:
    query = """
    SELECT META(p).id AS playbookId,
           ARRAY_LENGTH(p.embedding) AS embeddingLength
    FROM voyageops.agent.playbooks p
    WHERE META(p).id = $playbookId
    LIMIT 1
    """

    try:
        result = cluster.query(
            query,
            QueryOptions(named_parameters={"playbookId": playbook_id}),
        )
        rows = list(result.rows())
    except Exception as error:
        raise AgentWorkerError("playbook_search", f"Unable to validate playbook embedding: {error}") from error

    if not rows:
        raise AgentWorkerError("playbook_search", f"Matched playbook '{playbook_id}' could not be loaded for validation")

    embedding_length = rows[0].get("embeddingLength")
    if not isinstance(embedding_length, int) or embedding_length <= 0:
        raise AgentWorkerError(
            "playbook_search",
            (
                f"Matched playbook '{playbook_id}' has an invalid embedding (length={embedding_length}). "
                "Re-seed or repair the playbook embedding data before running the demo."
            ),
        )


@agentc.catalog.tool
def _find_playbook_id(
    cluster: Cluster,
    index_name: str,
    incident_vector: list[float],
    bucket_name: str,
) -> str:
    """Find the best-matching active playbook for an incident via vector search (FTS, falling back to GSI)."""
    available_indexes = _list_search_index_names(cluster)
    fts_index_name = _resolve_playbook_search_index_name(index_name, available_indexes, bucket_name)

    if fts_index_name:
        _verified_search_indexes.add(fts_index_name)
        try:
            request = search.SearchRequest.create(search.MatchAllQuery()).with_vector_search(
                VectorSearch.from_vector_query(VectorQuery("embedding", incident_vector))
            )
            search_result = cluster.search(
                fts_index_name,
                request,
                SearchOptions(limit=1),
            )
            rows = list(search_result.rows())
        except Exception as error:
            raise AgentWorkerError("playbook_search", f"Playbook vector search failed: {error}") from error

        if not rows:
            raise AgentWorkerError("playbook_search", "No matching playbook found for incident")

        playbook_id = getattr(rows[0], "id", None)
        if not playbook_id:
            raise AgentWorkerError("playbook_search", "Playbook search result did not include a document id")
        _ensure_playbook_embedding_is_valid(cluster, str(playbook_id))
        _emit_worker_metric(
            "playbook_vector_source",
            source="search_fts",
            indexName=fts_index_name,
            configuredIndexName=index_name,
        )
        return str(playbook_id)

    _emit_worker_metric(
        "playbook_vector_source",
        source="gsi_fallback",
        indexName=index_name,
        availableSearchIndexes=len(available_indexes),
    )
    return _find_playbook_id_via_gsi(cluster, index_name, incident_vector)


@agentc.catalog.tool
def _fetch_actions_and_policies(cluster: Cluster, playbook_id: str, loyalty_tier: str) -> ActionPolicyLoadResult:
    """Load eligible recovery actions and enabled policy rules for a playbook and guest loyalty tier."""
    eligible_actions_query = """
    SELECT a.actionId,
           a.label,
           a.description,
           a.estimatedValue,
           a.incidentCategory,
           a.incidentType,
           a.loyaltyTier
    FROM voyageops.agent.playbooks p
    UNNEST p.actionIds AS aid
    JOIN voyageops.agent.action_catalog a ON aid = a.actionId
    WHERE META(p).id = $playbookId
            AND (
                        (IS_STRING(a.loyaltyTier) AND LOWER(TRIM(a.loyaltyTier)) IN ["any", $loyaltyTier])
                        OR (
                                IS_ARRAY(a.loyaltyTier)
                                AND ANY tier IN a.loyaltyTier SATISFIES LOWER(TRIM(tier)) IN ["any", $loyaltyTier] END
                        )
                    )
      AND a.active = true
    """
    policies_query = "SELECT META(p).id AS policyId, p.* FROM voyageops.agent.policy_rules p WHERE p.enabled = true"
    playbook_incident_query = """
    SELECT p.incidentType
    FROM voyageops.agent.playbooks p
    WHERE META(p).id = $playbookId
    LIMIT 1
    """
    fallback_actions_by_incident_query = """
    SELECT a.actionId,
           a.label,
           a.description,
           a.estimatedValue,
           a.incidentCategory,
           a.incidentType,
           a.loyaltyTier
    FROM voyageops.agent.action_catalog a
    WHERE a.active = true
      AND LOWER(TRIM(a.incidentType)) = $incidentType
      AND (
            (IS_STRING(a.loyaltyTier) AND LOWER(TRIM(a.loyaltyTier)) IN ["any", $loyaltyTier])
            OR (
                IS_ARRAY(a.loyaltyTier)
                AND ANY tier IN a.loyaltyTier SATISFIES LOWER(TRIM(tier)) IN ["any", $loyaltyTier] END
            )
          )
    """

    try:
        action_rows = cluster.query(
            eligible_actions_query,
            QueryOptions(named_parameters={"playbookId": playbook_id, "loyaltyTier": str(loyalty_tier).strip().lower()}),
        )
        actions = [dict(row) for row in action_rows.rows()]
    except Exception as error:
        raise AgentWorkerError("load_actions", f"Unable to load actions or policies: {error}") from error

    global _policy_rules_cache
    if _policy_rules_cache is None:
        try:
            policy_rows = cluster.query(policies_query)
            _policy_rules_cache = [dict(row) for row in policy_rows.rows()]
        except Exception as error:
            raise AgentWorkerError("load_actions", f"Unable to load policy rules: {error}") from error
    policies = _policy_rules_cache

    # Always augment playbook actions with incident-typed catalog actions to guard
    # against stale/missing playbook actionIds while keeping data-driven behavior.
    try:
        playbook_rows = list(
            cluster.query(
                playbook_incident_query,
                QueryOptions(named_parameters={"playbookId": playbook_id}),
            ).rows()
        )
    except Exception as error:
        if not actions:
            raise AgentWorkerError(
                "load_actions",
                f"No eligible actions found for playbook {playbook_id}; also failed loading playbook metadata: {error}",
            ) from error
        playbook_rows = []

    incident_type = str(playbook_rows[0].get("incidentType") or "").strip().lower() if playbook_rows else ""

    if incident_type and not actions:
        try:
            fallback_rows = cluster.query(
                fallback_actions_by_incident_query,
                QueryOptions(
                    named_parameters={
                        "incidentType": incident_type,
                        "loyaltyTier": str(loyalty_tier).strip().lower(),
                    }
                ),
            )
            fallback_actions = [dict(row) for row in fallback_rows.rows()]

            if fallback_actions:
                actions = fallback_actions
                _emit_worker_metric(
                    "actions_fallback_used",
                    playbookId=playbook_id,
                    incidentType=incident_type,
                    loyaltyTier=str(loyalty_tier).strip().lower(),
                    actionCount=len(actions),
                )
        except Exception as error:
            if not actions:
                raise AgentWorkerError(
                    "load_actions",
                    (
                        f"No eligible actions found for playbook {playbook_id}; "
                        f"fallback by incidentType '{incident_type}' failed: {error}"
                    ),
                ) from error

    if not actions:
        _emit_worker_metric(
            "actions_missing_for_context",
            playbookId=playbook_id,
            incidentType=incident_type,
            loyaltyTier=str(loyalty_tier).strip().lower(),
        )
        return ActionPolicyLoadResult(
            actions=[],
            policies=policies,
            coverage_gap_reason=(
                f"No eligible actions found for playbook {playbook_id} "
                f"and incidentType '{incident_type}' / loyalty tier '{str(loyalty_tier).strip()}'"
            ),
        )

    def _is_any_tier_value(value: Any) -> bool:
        if isinstance(value, str):
            return value.strip().lower() == "any"
        if isinstance(value, list):
            normalized = {str(item).strip().lower() for item in value if str(item).strip()}
            return normalized == {"any"}
        return False

    # Enforce loyalty-tier suffix constraints at backend (not UI):
    # 1) loyaltyTier == "any" remains broadly applicable.
    # 2) *_vip actions are only for DIAMOND / ELITE PLATINUM.
    # 3) *_std actions are only for GOLD / EMERALD / PLATINUM.
    # 4) VIP tiers must not receive *_std; standard tiers must not receive *_vip.
    vip_tiers = {"diamond", "elite platinum"}
    standard_tiers = {"gold", "emerald", "platinum"}
    normalized_loyalty_tier = str(loyalty_tier).strip().lower()

    def _action_id(action: Mapping[str, Any]) -> str:
        return str(action.get("actionId") or "").strip().lower()

    def _is_vip_action(action: Mapping[str, Any]) -> bool:
        return _action_id(action).endswith("_vip")

    def _is_std_action(action: Mapping[str, Any]) -> bool:
        return _action_id(action).endswith("_std")

    filtered_by_tier_suffix: list[dict[str, Any]] = []
    for action in actions:
        if _is_vip_action(action) and normalized_loyalty_tier not in vip_tiers:
            continue
        if _is_std_action(action) and normalized_loyalty_tier not in standard_tiers:
            continue
        if normalized_loyalty_tier in vip_tiers and _is_std_action(action):
            continue
        if normalized_loyalty_tier in standard_tiers and _is_vip_action(action):
            continue
        filtered_by_tier_suffix.append(action)

    actions = filtered_by_tier_suffix

    if not actions:
        _emit_worker_metric(
            "actions_removed_by_tier_filter",
            playbookId=playbook_id,
            loyaltyTier=str(loyalty_tier).strip().lower(),
        )
        return ActionPolicyLoadResult(
            actions=[],
            policies=policies,
            coverage_gap_reason=(
                f"No eligible actions remained after loyalty-tier suffix filtering "
                f"for playbook {playbook_id} and loyalty tier '{str(loyalty_tier).strip()}'"
            ),
        )

    # For VIP tiers, optionally suppress generic "any" actions when tier-specific alternatives exist.
    if normalized_loyalty_tier in vip_tiers:
        tier_specific_action_ids = {
            action["actionId"] for action in actions if not _is_any_tier_value(action.get("loyaltyTier"))
        }
        if tier_specific_action_ids:
            actions = [action for action in actions if not _is_any_tier_value(action.get("loyaltyTier"))]

    # Remove loyaltyTier from output since it's only needed for filtering
    for action in actions:
        if "loyaltyTier" in action:
            del action["loyaltyTier"]

    return ActionPolicyLoadResult(actions=actions, policies=policies)


def _build_prompt(
    context: Mapping[str, Any],
    actions: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    system_message: str,
) -> tuple[str, str]:
    recent_incidents = int(context.get("recentIncidents") or 0)
    loyalty_tier = str(context.get("loyaltyTier") or "GOLD").upper()
    onboard_spend = float(context.get("onboardSpend") or 0)
    incident_type = str(context.get("type") or "").strip().lower()
    incident_category = str(context.get("category") or "").strip().lower()

    base_budget = min(500.0, max(75.0, round(onboard_spend * 0.06, 2)))
    tier_multiplier = {
        "DIAMOND": 1.75,
        "ELITE PLATINUM": 1.5,
        "EMERALD": 1.35,
        "PLATINUM": 1.2,
        "GOLD": 1.0,
    }.get(loyalty_tier, 1.0)
    max_recovery_budget = round(base_budget * tier_multiplier, 2)

    def _normalized_text(value: Any) -> str:
        return str(value or "").strip().lower()

    def _action_rank(action: Mapping[str, Any]) -> float:
        estimated = float(action.get("estimatedValue") or 0)
        action_type = _normalized_text(action.get("incidentType"))
        action_category = _normalized_text(action.get("incidentCategory"))

        type_match_bonus = 240 if incident_type and action_type == incident_type else 0
        category_match_bonus = 140 if incident_category and action_category == incident_category else 0
        mismatch_penalty = -220 if (incident_type and action_type and action_type != incident_type) else 0

        in_budget_bonus = 25 if estimated <= max_recovery_budget else -10
        recent_escalation_bonus = 8 if recent_incidents >= 2 else 0
        severity_bonus = 10 if str(context.get("severity", "")).lower() in {"high", "critical"} else 0
        value_weight = min(estimated, max_recovery_budget * 1.25)

        return (
            type_match_bonus
            + category_match_bonus
            + mismatch_penalty
            + in_budget_bonus
            + recent_escalation_bonus
            + severity_bonus
            + value_weight
        )

    ranked_actions = sorted(actions, key=_action_rank, reverse=True)
    shortlist = ranked_actions[: min(5, len(ranked_actions))]

    user_prompt = json.dumps(
        {
            "incident": {
                "incidentId": context["incidentId"],
                "description": context["description"],
                "severity": context["severity"],
                "category": context.get("category"),
                "type": context.get("type"),
                "status": context.get("status"),
                "guestSentiment": context.get("guestSentiment"),
            },
            "guest": {
                "guestId": context["guestId"],
                "loyaltyTier": context["loyaltyTier"],
                "onboardSpend": context.get("onboardSpend"),
                "recentIncidents": context.get("recentIncidents", 0),
            },
            # Constrain model selection to relevance-ranked candidates.
            "eligibleActions": shortlist,
            "actionShortlist": shortlist,
            "allowedActionIds": [str(action.get("actionId") or "") for action in shortlist],
            "policyRules": policies,
            "task": {
                "selectExactlyOneAction": True,
                "requireIncidentTypeCategoryFit": True,
                "escalateIfRecentIncidentsGte": 2,
                "targetMaxRecoveryBudget": max_recovery_budget,
                "actionIdMustBeFromAllowedActionIds": True,
                "responseSchema": {
                    "actionId": "string",
                    "summary": "string",
                    "justification": "string",
                    "priority": "low|medium|high",
                    "operatorMessage": "string",
                    "followUpQuestions": ["string"],
                    "alternativeActionIds": ["string"],
                },
            },
        }
    )
    return system_message, user_prompt


def _parse_recommendation(response_content: str, actions: list[dict[str, Any]], *, allow_safe_action_fallback: bool = False) -> dict[str, Any]:
    try:
        payload = json.loads(response_content)
    except json.JSONDecodeError as error:
        raise AgentWorkerError("llm_response", f"LLM returned invalid JSON: {error}") from error

    required_keys = ("actionId", "summary", "justification", "priority")
    missing_keys = [key for key in required_keys if not payload.get(key)]
    if missing_keys:
        raise AgentWorkerError("llm_response", f"LLM response missing required fields: {', '.join(missing_keys)}")

    def _normalize_action_id(value: Any) -> str:
        return str(value or "").strip().lower()

    def _resolve_action(action_id: Any) -> dict[str, Any] | None:
        requested = _normalize_action_id(action_id)
        if not requested:
            return None

        # 1) Exact match (case-insensitive)
        for action in actions:
            if _normalize_action_id(action.get("actionId")) == requested:
                return action

        # 2) Suffix-aware fallback: model may omit _vip/_std even though eligible actions include one.
        has_tier_suffix = requested.endswith("_vip") or requested.endswith("_std")
        if not has_tier_suffix:
            suffix_candidates = [
                action
                for action in actions
                if _normalize_action_id(action.get("actionId")).startswith(f"{requested}_")
                and (
                    _normalize_action_id(action.get("actionId")).endswith("_vip")
                    or _normalize_action_id(action.get("actionId")).endswith("_std")
                )
            ]
            if len(suffix_candidates) == 1:
                return suffix_candidates[0]

        return None

    selected_action = _resolve_action(payload["actionId"])
    if not selected_action:
        _emit_worker_metric(
            "llm_unknown_action_id",
            selectedActionId=str(payload.get("actionId") or ""),
            eligibleActionCount=len(actions),
        )
        if allow_safe_action_fallback and actions:
            selected_action = actions[0]
            _emit_worker_metric(
                "llm_unknown_action_fallback",
                selectedActionId=str(payload.get("actionId") or ""),
                fallbackActionId=str(selected_action.get("actionId") or ""),
                eligibleActionCount=len(actions),
            )
        else:
            raise AgentWorkerError("llm_response", f"LLM selected unknown actionId: {payload['actionId']}")

    priority = str(payload["priority"]).lower()
    if priority not in {"low", "medium", "high"}:
        raise AgentWorkerError("llm_response", f"LLM returned unsupported priority: {payload['priority']}")

    follow_up_questions_raw = payload.get("followUpQuestions")
    if isinstance(follow_up_questions_raw, list):
        follow_up_questions = [str(item).strip() for item in follow_up_questions_raw if str(item).strip()]
    else:
        follow_up_questions = []

    alternative_action_ids_raw = payload.get("alternativeActionIds")
    alternative_action_ids = (
        [str(item) for item in alternative_action_ids_raw if str(item)]
        if isinstance(alternative_action_ids_raw, list)
        else []
    )

    def _tokenize_action_text(value: str) -> set[str]:
        normalized = "".join(char.lower() if char.isalnum() else " " for char in value)
        return {token for token in normalized.split() if token and token not in {"the", "a", "an", "to", "for", "as", "and", "with", "of", "on", "in", "is", "was", "be", "or", "by", "guest", "mr", "stark"}}

    def _is_semantic_duplicate(base: Mapping[str, Any], candidate: Mapping[str, Any]) -> bool:
        if str(base.get("actionId")) == str(candidate.get("actionId")):
            return True

        base_text = f"{base.get('label', '')} {base.get('description', '')}".strip()
        candidate_text = f"{candidate.get('label', '')} {candidate.get('description', '')}".strip()
        base_tokens = _tokenize_action_text(base_text)
        candidate_tokens = _tokenize_action_text(candidate_text)

        if not base_tokens or not candidate_tokens:
            return False

        overlap = len(base_tokens & candidate_tokens)
        smaller = min(len(base_tokens), len(candidate_tokens))
        return smaller > 0 and (overlap / smaller) >= 0.7

    alternatives: list[dict[str, Any]] = []

    def _already_has_semantic_duplicate(candidate: Mapping[str, Any], existing: list[dict[str, Any]]) -> bool:
        if _is_semantic_duplicate(selected_action, candidate):
            return True

        for entry in existing:
            if _is_semantic_duplicate(entry, candidate):
                return True

        return False

    for action_id in alternative_action_ids:
        resolved_alt = _resolve_action(action_id)
        if not resolved_alt:
            continue
        if str(resolved_alt.get("actionId")) == str(selected_action["actionId"]):
            continue
        if not _already_has_semantic_duplicate(resolved_alt, alternatives):
            alternatives.append(
                {
                    "actionId": str(resolved_alt["actionId"]),
                    "label": str(resolved_alt["label"]),
                    "description": str(resolved_alt.get("description") or ""),
                    "estimatedValue": float(resolved_alt.get("estimatedValue") or 0),
                }
            )

    if not alternatives:
        for fallback in actions:
            if fallback.get("actionId") == selected_action["actionId"]:
                continue
            if _already_has_semantic_duplicate(fallback, alternatives):
                continue
            alternatives.append(
                {
                    "actionId": str(fallback["actionId"]),
                    "label": str(fallback["label"]),
                    "description": str(fallback.get("description") or ""),
                    "estimatedValue": float(fallback.get("estimatedValue") or 0),
                }
            )
            if len(alternatives) >= 2:
                break

    operator_message = str(payload.get("operatorMessage") or payload["summary"]).strip()

    return {
        "summary": str(payload["summary"]),
        "reasoning": str(payload["justification"]),
        "priority": priority,
        "actions": [
            {
                "actionId": str(selected_action["actionId"]),
                "label": str(selected_action["label"]),
                "description": str(selected_action.get("description") or ""),
                "estimatedValue": float(selected_action.get("estimatedValue") or 0),
            }
        ],
        "interactive": {
            "operatorMessage": operator_message,
            "followUpQuestions": follow_up_questions[:3],
            "alternativeActions": alternatives[:3],
        },
    }


def _generate_recommendation(
    client: OpenAI,
    settings: Settings,
    context: Mapping[str, Any],
    actions: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    span: Any,
) -> dict[str, Any]:
    system_message = _resolve_system_message(settings)
    _, user_prompt = _build_prompt(context, actions, policies, system_message)

    base_messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_prompt},
    ]

    def _run_completion(messages: list[dict[str, str]]) -> str:
        with span.new(name="llm_reasoning") as llm_span:
            llm_span.log(content=agentc.span.SystemContent(value=messages[0]["content"]))
            llm_span.log(content=agentc.span.UserContent(value=messages[-1]["content"]))
            try:
                response = client.chat.completions.create(
                    model=settings.openai_model,
                    messages=messages,
                    response_format={"type": "json_object"},
                )
            except Exception as error:
                llm_span.log(content=agentc.span.KeyValueContent(key="error", value=str(error)))
                raise AgentWorkerError("llm_reasoning", f"OpenAI completion failed: {error}") from error

            message_content = response.choices[0].message.content if response.choices else None
            if not message_content:
                llm_span.log(content=agentc.span.KeyValueContent(key="error", value="empty completion"))
                raise AgentWorkerError("llm_reasoning", "OpenAI completion returned no content")

            llm_span.log(content=agentc.span.ChatCompletionContent(output=message_content))
            return message_content

    first_content = _run_completion(base_messages)
    try:
        return _parse_recommendation(first_content, actions)
    except AgentWorkerError as error:
        if error.step != "llm_response" or "unknown actionId" not in error.message:
            raise

        allowed_action_ids = [str(action.get("actionId") or "") for action in actions if str(action.get("actionId") or "")]
        retry_messages = [
            *base_messages,
            {
                "role": "system",
                "content": (
                    "Your previous response selected an invalid actionId. "
                    f"Return valid JSON and choose actionId strictly from this list: {allowed_action_ids}"
                ),
            },
        ]
        _emit_worker_metric("llm_retry_unknown_action_id", allowedActionCount=len(allowed_action_ids))
        retry_content = _run_completion(retry_messages)
        return _parse_recommendation(retry_content, actions, allow_safe_action_fallback=True)


def _build_coverage_gap_recommendation(
    context: Mapping[str, Any],
    playbook_id: str,
    policies: list[dict[str, Any]],
) -> dict[str, Any]:
    incident_type = str(context.get("type") or "unknown").strip().lower()
    incident_category = str(context.get("category") or "unknown").strip().lower()
    severity = str(context.get("severity") or "medium").strip().lower()
    loyalty_tier = str(context.get("loyaltyTier") or "any").strip().lower()
    incident_id = str(context.get("incidentId") or "")
    guest_id = str(context.get("guestId") or "")

    action_seed = f"ac_{incident_type}_{incident_category}_{loyalty_tier}".replace("-", "_").replace(" ", "_")
    generated_action_ids = [
        f"{action_seed}_stabilize",
        f"{action_seed}_restore",
    ]

    missing_artifacts: list[dict[str, Any]] = [
        {
            "artifactType": "action_catalog",
            "title": f"Create action catalog entries for {incident_type}/{incident_category}",
            "rationale": "No eligible action_catalog entries were available for this context.",
            "priority": "high",
            "draft": {
                "incidentType": incident_type,
                "incidentCategory": incident_category,
                "loyaltyTier": loyalty_tier,
                "candidates": [
                    {
                        "actionId": generated_action_ids[0],
                        "label": "Immediate guest stabilization outreach",
                        "description": "Acknowledge incident impact and confirm active ownership within SLA.",
                        "estimatedValue": 0,
                    },
                    {
                        "actionId": generated_action_ids[1],
                        "label": "Context-specific service restoration",
                        "description": "Execute incident-specific restoration and confirm service recovery with guest.",
                        "estimatedValue": 0,
                    },
                ],
            },
        },
        {
            "artifactType": "playbook",
            "title": f"Expand playbook coverage for {incident_type}/{severity}",
            "rationale": "Current playbook does not map to actionable catalog steps for this guest context.",
            "priority": "high",
            "draft": {
                "playbookIdSuggestion": f"playbooks::{incident_type}_{severity}_{loyalty_tier}_draft",
                "title": f"{incident_type} {severity} recovery baseline",
                "incidentType": incident_type,
                "severity": severity,
                "loyaltyTier": loyalty_tier,
                "actionIds": generated_action_ids,
            },
        },
    ]

    if not policies:
        missing_artifacts.append(
            {
                "artifactType": "policy_rule",
                "title": f"Create policy rule for {incident_type}/{severity}",
                "rationale": "No enabled policy rules were loaded for this incident context.",
                "priority": "medium",
                "draft": {
                    "ruleIdSuggestion": f"policy_rules::{incident_type}_{severity}_draft",
                    "name": f"{incident_type} governance guardrail",
                    "incidentType": incident_type,
                    "severity": severity,
                    "constraints": {
                        "requiresSupervisorApproval": True,
                        "maxAutoCompensation": 0,
                        "requiredFollowUpMinutes": 30,
                    },
                },
            }
        )

    return {
        "summary": "Coverage gap detected: draft playbook/action artifacts required before recommendation can be finalized.",
        "reasoning": (
            f"No eligible actions were available for incident {incident_id} ({incident_type}/{incident_category}) "
            f"and guest {guest_id}. Generated draft artifacts for reconsideration and policy review."
        ),
        "priority": "high",
        "status": "coverage_gap_drafts_ready",
        "actions": [],
        "interactive": {
            "operatorMessage": "Recovery recommendation paused pending approval of generated action/playbook drafts.",
            "followUpQuestions": [
                "Should I stage these draft artifacts for supervisor review?",
                "Do you want standard or VIP-first handling for this context?",
            ],
            "alternativeActions": [],
        },
        "coverageGap": {
            "playbookId": playbook_id,
            "incidentType": incident_type,
            "incidentCategory": incident_category,
            "severity": severity,
            "loyaltyTier": loyalty_tier,
            "missingArtifacts": missing_artifacts,
        },
    }


def _write_proposal(
    action_proposals_collection: Any,
    run_document: Mapping[str, Any],
    recommendation: Mapping[str, Any],
) -> str:
    incident_id = str(run_document["incidentId"])
    guest_id = str(run_document["guestId"])
    # Deterministic key prevents duplicate proposal docs for the same incident/guest.
    proposal_id = f"proposal::guest-recovery::{incident_id}::{guest_id}"
    timestamp = _utc_now_iso()
    proposal_document = {
        "proposalId": proposal_id,
        "agentRunId": run_document["runId"],
        "runId": run_document["runId"],
        "guestId": run_document["guestId"],
        "incidentId": run_document["incidentId"],
        "status": str(recommendation.get("status") or "proposed"),
        "summary": recommendation["summary"],
        "reasoning": recommendation["reasoning"],
        "priority": recommendation["priority"],
        "actions": recommendation["actions"],
        "interactive": recommendation.get("interactive", {}),
        "coverageGap": recommendation.get("coverageGap"),
        "approval": {
            "required": True,
            "approverRole": "guest-services-supervisor",
        },
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }

    try:
        action_proposals_collection.upsert(proposal_id, proposal_document)
    except Exception as error:
        raise AgentWorkerError("write_proposal", f"Unable to write action proposal: {error}") from error

    return proposal_id


def run_guest_recovery_agent(
    agent_run_or_id: str | Mapping[str, Any],
    cluster: Cluster | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    resolved_cluster = cluster or create_cluster(settings)
    openai_client = create_openai_client(settings)
    collections = _agent_collections(resolved_cluster, settings.couchbase_bucket)

    run_id: str | None = None
    run_document: dict[str, Any] | None = None

    try:
        run_id, run_document = _normalize_run_document(agent_run_or_id, collections["agent_runs"])
        run_document = _update_run_status(
            collections["agent_runs"],
            run_id,
            run_document,
            status="started",
            step="load_run",
        )

        root_span = _get_root_span(
            settings, run_id, str(run_document["incidentId"]), str(run_document["guestId"])
        )
        with root_span as span:
            context = _fetch_incident_context(resolved_cluster, str(run_document["incidentId"]))
            sentiment = _traced_tool_call(
                span,
                "analyze_guest_sentiment",
                {"incidentId": str(context.get("incidentId") or ""), "description": str(context.get("description") or "")[:200]},
                _analyze_guest_sentiment,
                resolved_cluster,
                str(context["incidentId"]),
                str(context["description"]),
            )
            if sentiment:
                context["guestSentiment"] = sentiment
            playbook_id = _find_playbook_id_from_context(resolved_cluster, context)
            if playbook_id:
                _emit_worker_metric(
                    "playbook_context_match_used",
                    playbookId=playbook_id,
                    incidentType=str(context.get("type") or ""),
                    severity=str(context.get("severity") or ""),
                    loyaltyTier=str(context.get("loyaltyTier") or ""),
                )
            else:
                incident_vector = _extract_incident_vector_from_context(context)
                if incident_vector:
                    _emit_worker_metric(
                        "playbook_vector_source",
                        source="incident_document",
                        vectorLength=len(incident_vector),
                        incidentId=str(context.get("incidentId") or ""),
                    )
                else:
                    incident_vector = _traced_tool_call(
                        span,
                        "create_incident_embedding",
                        {"description": str(context["description"])[:200], "model": settings.openai_embed_model},
                        _create_incident_embedding,
                        openai_client,
                        settings,
                        str(context["description"]),
                        result_summary=lambda vector: {"vectorLength": len(vector)},
                    )
                    _emit_worker_metric(
                        "playbook_vector_source",
                        source="openai_runtime",
                        incidentId=str(context.get("incidentId") or ""),
                    )
                playbook_id = _traced_tool_call(
                    span,
                    "find_playbook_id",
                    {
                        "indexName": settings.playbook_index_name,
                        "bucketName": settings.couchbase_bucket,
                        "vectorLength": len(incident_vector),
                    },
                    _find_playbook_id,
                    resolved_cluster,
                    settings.playbook_index_name,
                    incident_vector,
                    settings.couchbase_bucket,
                )
            action_policy_result = _traced_tool_call(
                span,
                "fetch_actions_and_policies",
                {"playbookId": playbook_id, "loyaltyTier": str(context["loyaltyTier"])},
                _fetch_actions_and_policies,
                resolved_cluster,
                playbook_id,
                str(context["loyaltyTier"]),
                result_summary=lambda result: {
                    "actionCount": len(result.actions),
                    "policyCount": len(result.policies),
                    "coverageGapReason": result.coverage_gap_reason,
                },
            )
            actions = action_policy_result.actions
            policies = action_policy_result.policies
            if action_policy_result.coverage_gap_reason:
                recommendation = _build_coverage_gap_recommendation(context, playbook_id, policies)
                _emit_worker_metric(
                    "coverage_gap_drafts_created",
                    incidentId=str(context.get("incidentId") or ""),
                    guestId=str(context.get("guestId") or ""),
                    playbookId=playbook_id,
                    reason=action_policy_result.coverage_gap_reason,
                )
            else:
                recommendation = _generate_recommendation(
                    openai_client, settings, context, actions, policies, span=span
                )
            proposal_id = _write_proposal(collections["action_proposals"], run_document, recommendation)
            next_status = (
                "coverage_gap_drafts_ready"
                if recommendation.get("status") == "coverage_gap_drafts_ready"
                else "awaiting_approval"
            )
            span.log(content=agentc.span.KeyValueContent(key="proposalId", value=proposal_id))

        _update_run_status(
            collections["agent_runs"],
            run_id,
            run_document,
            status=next_status,
            step="write_proposal",
            proposal_id=proposal_id,
        )
        return {
            "runId": run_id,
            "proposalId": proposal_id,
            "incidentId": run_document["incidentId"],
            "guestId": run_document["guestId"],
            "status": next_status,
        }
    except AgentWorkerError as error:
        if run_id and run_document is not None:
            try:
                _update_run_status(
                    collections["agent_runs"],
                    run_id,
                    run_document,
                    status="failed",
                    step=error.step,
                    error_message=error.message,
                )
            except AgentWorkerError as status_error:
                LOGGER.warning("Failed to persist agent run failure status: %s", status_error.message)
        raise
    except Exception as error:
        if run_id and run_document is not None:
            try:
                _update_run_status(
                    collections["agent_runs"],
                    run_id,
                    run_document,
                    status="failed",
                    step="unexpected_error",
                    error_message=str(error),
                )
            except AgentWorkerError as status_error:
                LOGGER.warning("Failed to persist unexpected-error status: %s", status_error.message)
        raise AgentWorkerError("unexpected_error", str(error)) from error
