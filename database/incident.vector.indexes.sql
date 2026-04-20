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
