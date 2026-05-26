-- ============================================================================
-- Incident Vector Indexes (guests.incidents)
--
-- These correspond to env vars consumed by src/api/routes.ts:
--   CB_VECTOR_INDEX_CATEGORY
--   CB_VECTOR_INDEX_TYPE
--   CB_VECTOR_INDEX_DESC
--   CB_VECTOR_INDEX_OUTCOMES  →  voyageops.agent.outcomes(embedding)
--
-- If you change index names here, update .env accordingly.
-- ============================================================================

CREATE VECTOR INDEX voGuestIncident_vector_category_incidents IF NOT EXISTS
ON voyageops.guests.incidents(vector_category_incidents VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voGuestIncident_vector_type_incidents IF NOT EXISTS
ON voyageops.guests.incidents(vector_type_incidents VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voGuestIncident_vector_desc_incidents IF NOT EXISTS
ON voyageops.guests.incidents(vector_desc_incidents VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

-- ============================================================================
-- Query GSI vector indexes (APPROX_VECTOR_DISTANCE in SQL++ / Express API)
--
-- Guest Recovery Python worker playbook search uses a separate Couchbase SEARCH
-- index (hybrid FTS + vector). Deploy via npm run demo:setup-vector-indexes
-- (see database/search-indexes/voAgent_vector_playbooks_embedding.json).
--
-- Field names assumed:
--    - action_catalog.embedding
--    - playbooks.embedding
--    - outcomes.embedding (collection empty until execution write-back;
--      index is still created; reaches Ready after documents with embeddings exist)
-- ============================================================================

CREATE VECTOR INDEX voAgent_vector_action_catalog_embedding IF NOT EXISTS
ON voyageops.agent.action_catalog(embedding VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voAgent_vector_playbooks_embedding IF NOT EXISTS
ON voyageops.agent.playbooks(embedding VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voAgent_vector_outcomes_embedding IF NOT EXISTS
ON voyageops.agent.outcomes(embedding VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};
