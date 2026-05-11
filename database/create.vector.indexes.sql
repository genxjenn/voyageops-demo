-- ============================================================================
-- Incident Vector Indexes (guests.incidents)
--
-- These correspond to env vars consumed by src/api/routes.ts:
--   CB_VECTOR_INDEX_CATEGORY
--   CB_VECTOR_INDEX_TYPE
--   CB_VECTOR_INDEX_DESC
--
-- If you change index names here, update .env accordingly.
-- ============================================================================

CREATE VECTOR INDEX voGuestIncident_vector_category_incidents
ON voyageops.guests.incidents(vector_category_incidents VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voGuestIncident_vector_type_incidents
ON voyageops.guests.incidents(vector_type_incidents VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

CREATE VECTOR INDEX voGuestIncident_vector_desc_incidents
ON voyageops.guests.incidents(vector_desc_incidents VECTOR)
WITH {
  "dimension": 1536,
  "similarity": "L2",
  "description": "IVF,SQ8"
};

-- ============================================================================
-- Vector Indexes (SQL++ Vector Index / GSI style)
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

