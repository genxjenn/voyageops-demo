-- ============================================================================
-- 1) Scope + Collections
-- ============================================================================

CREATE SCOPE voyageops.agent;

CREATE COLLECTION voyageops.agent.action_catalog;
CREATE COLLECTION voyageops.agent.playbooks;
CREATE COLLECTION voyageops.agent.policy_rules;
CREATE COLLECTION voyageops.agent.agent_runs;
CREATE COLLECTION voyageops.agent.action_proposals;
CREATE COLLECTION voyageops.agent.action_executions;
CREATE COLLECTION voyageops.agent.outcomes;
CREATE COLLECTION voyageops.agent.chat_sessions;
CREATE COLLECTION voyageops.agent.chat_messages;

-- ============================================================================
-- 2) Primary Indexes (optional but useful for ad hoc debugging)
--    Keep or remove based on your production policy.
-- ============================================================================

CREATE PRIMARY INDEX voAgent_pi_action_catalog
ON voyageops.agent.action_catalog;

CREATE PRIMARY INDEX voAgent_pi_playbooks
ON voyageops.agent.playbooks;

CREATE PRIMARY INDEX voAgent_pi_policy_rules
ON voyageops.agent.policy_rules;

CREATE PRIMARY INDEX voAgent_pi_agent_runs
ON voyageops.agent.agent_runs;

CREATE PRIMARY INDEX voAgent_pi_action_proposals
ON voyageops.agent.action_proposals;

CREATE PRIMARY INDEX voAgent_pi_action_executions
ON voyageops.agent.action_executions;

CREATE PRIMARY INDEX voAgent_pi_outcomes
ON voyageops.agent.outcomes;

CREATE PRIMARY INDEX voAgent_pi_chat_sessions
ON voyageops.agent.chat_sessions;

CREATE PRIMARY INDEX voAgent_pi_chat_messages
ON voyageops.agent.chat_messages;

-- ============================================================================
-- 3) Operational GSI Indexes - TBD determined after testing with volume of data and query patterns
-- ============================================================================
CREATE INDEX ix_agent_runs_pending_createdAt
ON voyageops.agent.agent_runs(createdAt)
WHERE status = "pending";

