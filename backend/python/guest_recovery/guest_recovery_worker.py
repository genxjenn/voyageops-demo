import json
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

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
    )


def create_cluster(settings: Settings) -> Cluster:
    auth = PasswordAuthenticator(settings.couchbase_user, settings.couchbase_password)
    return Cluster(settings.couchbase_endpoint, ClusterOptions(auth))


def create_openai_client(settings: Settings) -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


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


def _merge_and_upsert(collection: Any, document_id: str, current: Mapping[str, Any], updates: Mapping[str, Any]) -> None:
    merged = dict(current)
    merged.update(updates)
    collection.upsert(document_id, merged)


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

    _merge_and_upsert(agent_runs_collection, run_id, current_run, updates)
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


def _create_incident_embedding(client: OpenAI, settings: Settings, description: str) -> list[float]:
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


def _ensure_search_index_exists(cluster: Cluster, index_name: str) -> None:
    try:
        indexes = cluster.search_indexes().get_all_indexes()
    except Exception as error:
        raise AgentWorkerError("playbook_search", f"Unable to inspect search indexes: {error}") from error

    available_indexes = sorted(idx.name for idx in indexes)
    if index_name not in available_indexes:
        available_text = ", ".join(available_indexes) if available_indexes else "none"
        raise AgentWorkerError(
            "playbook_search",
            (
                f"Configured playbook index '{index_name}' was not found. "
                f"Available search indexes: {available_text}. "
                "Set CB_PLAYBOOK_VECTOR_INDEX to the correct index name or create the expected playbook vector index."
            ),
        )


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


def _find_playbook_id(cluster: Cluster, index_name: str, incident_vector: list[float]) -> str:
    _ensure_search_index_exists(cluster, index_name)

    try:
        request = search.SearchRequest.create(search.MatchAllQuery()).with_vector_search(
            VectorSearch.from_vector_query(VectorQuery("embedding", incident_vector))
        )
        search_result = cluster.search(
            index_name,
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
    return str(playbook_id)


def _fetch_actions_and_policies(cluster: Cluster, playbook_id: str, loyalty_tier: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    eligible_actions_query = """
    SELECT a.actionId,
           a.label,
           a.description,
           a.estimatedValue
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

    try:
        action_rows = cluster.query(
            eligible_actions_query,
            QueryOptions(named_parameters={"playbookId": playbook_id, "loyaltyTier": str(loyalty_tier).strip().lower()}),
        )
        policy_rows = cluster.query(policies_query)
        actions = [dict(row) for row in action_rows.rows()]
        policies = [dict(row) for row in policy_rows.rows()]
    except Exception as error:
        raise AgentWorkerError("load_actions", f"Unable to load actions or policies: {error}") from error

    if not actions:
        raise AgentWorkerError("load_actions", f"No eligible actions found for playbook {playbook_id}")

    return actions, policies


def _build_prompt(context: Mapping[str, Any], actions: list[dict[str, Any]], policies: list[dict[str, Any]]) -> tuple[str, str]:
    recent_incidents = int(context.get("recentIncidents") or 0)
    loyalty_tier = str(context.get("loyaltyTier") or "GOLD").upper()
    onboard_spend = float(context.get("onboardSpend") or 0)

    base_budget = min(500.0, max(75.0, round(onboard_spend * 0.06, 2)))
    tier_multiplier = {
        "DIAMOND": 1.75,
        "ELITE PLATINUM": 1.5,
        "EMERALD": 1.35,
        "PLATINUM": 1.2,
        "GOLD": 1.0,
    }.get(loyalty_tier, 1.0)
    max_recovery_budget = round(base_budget * tier_multiplier, 2)

    def _action_rank(action: Mapping[str, Any]) -> float:
        estimated = float(action.get("estimatedValue") or 0)
        in_budget_bonus = 25 if estimated <= max_recovery_budget else -10
        recent_escalation_bonus = 8 if recent_incidents >= 2 else 0
        severity_bonus = 10 if str(context.get("severity", "")).lower() in {"high", "critical"} else 0
        return estimated + in_budget_bonus + recent_escalation_bonus + severity_bonus

    ranked_actions = sorted(actions, key=_action_rank, reverse=True)
    shortlist = ranked_actions[: min(5, len(ranked_actions))]

    system_message = (
        "You are the VoyageOps Guest Recovery Agent. "
        "Select one approved recovery action from the eligible catalog and explain why it is the best fit. "
        "Also provide interactive alternatives and follow-up prompts an operator can use immediately. "
        "Strictly adhere to policy rules. "
        "Return valid JSON only."
    )
    user_prompt = json.dumps(
        {
            "incident": {
                "incidentId": context["incidentId"],
                "description": context["description"],
                "severity": context["severity"],
                "category": context.get("category"),
                "type": context.get("type"),
                "status": context.get("status"),
            },
            "guest": {
                "guestId": context["guestId"],
                "loyaltyTier": context["loyaltyTier"],
                "onboardSpend": context.get("onboardSpend"),
                "recentIncidents": context.get("recentIncidents", 0),
            },
            "eligibleActions": actions,
            "actionShortlist": shortlist,
            "policyRules": policies,
            "task": {
                "selectExactlyOneAction": True,
                "escalateIfRecentIncidentsGte": 2,
                "targetMaxRecoveryBudget": max_recovery_budget,
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


def _parse_recommendation(response_content: str, actions: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        payload = json.loads(response_content)
    except json.JSONDecodeError as error:
        raise AgentWorkerError("llm_response", f"LLM returned invalid JSON: {error}") from error

    required_keys = ("actionId", "summary", "justification", "priority")
    missing_keys = [key for key in required_keys if not payload.get(key)]
    if missing_keys:
        raise AgentWorkerError("llm_response", f"LLM response missing required fields: {', '.join(missing_keys)}")

    selected_action = next((action for action in actions if action.get("actionId") == payload["actionId"]), None)
    if not selected_action:
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

    alternatives: list[dict[str, Any]] = []
    for action_id in alternative_action_ids:
        if action_id == selected_action["actionId"]:
            continue
        alt = next((action for action in actions if action.get("actionId") == action_id), None)
        if alt:
            alternatives.append(
                {
                    "actionId": str(alt["actionId"]),
                    "label": str(alt["label"]),
                    "description": str(alt.get("description") or ""),
                    "estimatedValue": float(alt.get("estimatedValue") or 0),
                }
            )

    if not alternatives:
        for fallback in actions:
            if fallback.get("actionId") == selected_action["actionId"]:
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
) -> dict[str, Any]:
    system_message, user_prompt = _build_prompt(context, actions, policies)

    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
    except Exception as error:
        raise AgentWorkerError("llm_reasoning", f"OpenAI completion failed: {error}") from error

    message_content = response.choices[0].message.content if response.choices else None
    if not message_content:
        raise AgentWorkerError("llm_reasoning", "OpenAI completion returned no content")

    return _parse_recommendation(message_content, actions)


def _write_proposal(
    action_proposals_collection: Any,
    run_document: Mapping[str, Any],
    recommendation: Mapping[str, Any],
) -> str:
    proposal_id = f"prop_{uuid.uuid4()}"
    timestamp = _utc_now_iso()
    proposal_document = {
        "proposalId": proposal_id,
        "agentRunId": run_document["runId"],
        "runId": run_document["runId"],
        "guestId": run_document["guestId"],
        "incidentId": run_document["incidentId"],
        "status": "proposed",
        "summary": recommendation["summary"],
        "reasoning": recommendation["reasoning"],
        "priority": recommendation["priority"],
        "actions": recommendation["actions"],
        "interactive": recommendation.get("interactive", {}),
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


def run_guest_recovery_agent(agent_run_or_id: str | Mapping[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    cluster = create_cluster(settings)
    openai_client = create_openai_client(settings)
    collections = _agent_collections(cluster, settings.couchbase_bucket)

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

        context = _fetch_incident_context(cluster, str(run_document["incidentId"]))
        incident_vector = _create_incident_embedding(openai_client, settings, str(context["description"]))
        playbook_id = _find_playbook_id(cluster, settings.playbook_index_name, incident_vector)
        actions, policies = _fetch_actions_and_policies(cluster, playbook_id, str(context["loyaltyTier"]))
        recommendation = _generate_recommendation(openai_client, settings, context, actions, policies)
        proposal_id = _write_proposal(collections["action_proposals"], run_document, recommendation)

        _update_run_status(
            collections["agent_runs"],
            run_id,
            run_document,
            status="awaiting_approval",
            step="write_proposal",
            proposal_id=proposal_id,
        )
        return {
            "runId": run_id,
            "proposalId": proposal_id,
            "incidentId": run_document["incidentId"],
            "guestId": run_document["guestId"],
            "status": "awaiting_approval",
        }
    except AgentWorkerError as error:
        if run_id and run_document is not None:
            _update_run_status(
                collections["agent_runs"],
                run_id,
                run_document,
                status="failed",
                step=error.step,
                error_message=error.message,
            )
        raise
    except Exception as error:
        if run_id and run_document is not None:
            _update_run_status(
                collections["agent_runs"],
                run_id,
                run_document,
                status="failed",
                step="unexpected_error",
                error_message=str(error),
            )
        raise AgentWorkerError("unexpected_error", str(error)) from error
