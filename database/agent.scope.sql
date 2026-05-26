-- ============================================================================
-- 1) Scope + Collections
-- ============================================================================

CREATE SCOPE voyageops.agent IF NOT EXISTS;

CREATE COLLECTION voyageops.agent.action_catalog IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.playbooks IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.policy_rules IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.agent_runs IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.action_proposals IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.action_executions IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.outcomes IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.chat_sessions IF NOT EXISTS;
CREATE COLLECTION voyageops.agent.chat_messages IF NOT EXISTS;

-- ============================================================================
-- 2) Primary Indexes (optional but useful for ad hoc debugging)
--    Keep or remove based on your production policy.
-- ============================================================================

CREATE PRIMARY INDEX voAgent_pi_action_catalog IF NOT EXISTS
ON voyageops.agent.action_catalog;

CREATE PRIMARY INDEX voAgent_pi_playbooks IF NOT EXISTS
ON voyageops.agent.playbooks;

CREATE PRIMARY INDEX voAgent_pi_policy_rules IF NOT EXISTS
ON voyageops.agent.policy_rules;

CREATE PRIMARY INDEX voAgent_pi_agent_runs IF NOT EXISTS
ON voyageops.agent.agent_runs;

CREATE PRIMARY INDEX voAgent_pi_action_proposals IF NOT EXISTS
ON voyageops.agent.action_proposals;

CREATE PRIMARY INDEX voAgent_pi_action_executions IF NOT EXISTS
ON voyageops.agent.action_executions;

CREATE PRIMARY INDEX voAgent_pi_outcomes IF NOT EXISTS
ON voyageops.agent.outcomes;

CREATE PRIMARY INDEX voAgent_pi_chat_sessions IF NOT EXISTS
ON voyageops.agent.chat_sessions;

CREATE PRIMARY INDEX voAgent_pi_chat_messages IF NOT EXISTS
ON voyageops.agent.chat_messages;

-- ============================================================================
-- 3) Operational GSI Indexes - TBD determined after testing with volume of data and query patterns
-- ============================================================================
CREATE INDEX ix_agent_runs_pending_createdAt IF NOT EXISTS
ON voyageops.agent.agent_runs(createdAt)
WHERE status = "pending";
