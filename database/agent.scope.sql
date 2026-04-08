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

-- ============================================================================
-- 3) Operational GSI Indexes - TBD determined after testing with volume of data and query patterns
-- ============================================================================

-- Action catalog lookup (by incident type/category/tier and active flag)
--CREATE INDEX voAgent_action_catalog_lookup
--ON voyageops.agent.action_catalog(incidentType, incidentCategory, loyaltyTier, active, updatedAt DESC);

-- Playbook lookup
--CREATE INDEX voAgent_playbooks_lookup
--ON voyageops.agent.playbooks(agentType, incidentType, severity, loyaltyTier, updatedAt DESC);

-- Policy rules lookup
--CREATE INDEX voAgent_policy_rules_lookup
--ON voyageops.agent.policy_rules(agentType, incidentType, severity, priority, enabled, updatedAt DESC);

-- Agent run retrieval
--CREATE INDEX voAgent_agent_runs_guest_incident
--ON voyageops.agent.agent_runs(guestId, incidentId, createdAt DESC);

--CREATE INDEX voAgent_agent_runs_status_createdAt
--ON voyageops.agent.agent_runs(status, createdAt DESC);

-- Approval queue
--CREATE INDEX voAgent_action_proposals_status_createdAt
--ON voyageops.agent.action_proposals(status, createdAt DESC);

--CREATE INDEX voAgent_action_proposals_guest_incident
--ON voyageops.agent.action_proposals(guestId, incidentId, createdAt DESC);

--CREATE INDEX voAgent_action_proposals_run
--ON voyageops.agent.action_proposals(agentRunId, createdAt DESC);

-- Execution tracking
--CREATE INDEX voAgent_action_executions_status_updatedAt
--ON voyageops.agent.action_executions(status, updatedAt DESC);

--CREATE INDEX voAgent_action_executions_guest_incident
--ON voyageops.agent.action_executions(guestId, incidentId, updatedAt DESC);

CREATE INDEX voAgent_action_executions_proposalId
ON voyageops.agent.action_executions(proposalId, updatedAt DESC);

-- Outcome measurement
CREATE INDEX voAgent_outcomes_guest_incident
ON voyageops.agent.outcomes(guestId, incidentId, measuredAt DESC);

CREATE INDEX voAgent_outcomes_execution
ON voyageops.agent.outcomes(executionId, measuredAt DESC);

-- ============================================================================
-- 4) Vector Indexes (SQL++ Vector Index / GSI style)
--    Field names assumed:
--    - action_catalog.embedding
--    - playbooks.embedding
--    - outcomes.embedding
-- ============================================================================

CREATE VECTOR INDEX voAgent_vector_action_catalog_embedding
ON voyageops.agent.action_catalog(embedding VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voAgent_vector_playbooks_embedding
ON voyageops.agent.playbooks(embedding VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voAgent_vector_outcomes_embedding
ON voyageops.agent.outcomes(embedding VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};
