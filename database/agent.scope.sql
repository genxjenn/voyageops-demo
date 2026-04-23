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

CREATE INDEX voAgent_idx_agent_runs_status_createdAt
ON voyageops.agent.agent_runs(status, createdAt);

-- Proposal lookup query used by guest-recovery chat/API:
--   WHERE p.incidentId = $incidentId ORDER BY p.createdAt DESC LIMIT 1
CREATE INDEX voAgent_idx_action_proposals_incident_createdAt
ON voyageops.agent.action_proposals(incidentId, createdAt DESC);

-- Chat memory lookup query used by /api/agent-query:
--   WHERE m.sessionId = $sessionId AND m.agentType = $agentType
--   ORDER BY m.createdAt DESC, m.messageId DESC LIMIT $limit
CREATE INDEX voAgent_idx_chat_messages_session_agent_created_message
ON voyageops.agent.chat_messages(sessionId, agentType, createdAt DESC, messageId DESC);

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
