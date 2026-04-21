-- ============================================================================
-- Eventing Scope + Metadata Collection
-- ============================================================================

CREATE SCOPE voyageops.eventing;

CREATE COLLECTION voyageops.eventing.sysdata;

-- ============================================================================
-- Eventing Function Deployment Notes
-- ============================================================================
-- This file creates the Eventing metadata keyspace used by Eventing functions.
-- After running the DDL above, deploy these handlers from the Eventing UI.

-- 1) Guest Recovery Trigger
--    Handler code: database/eventing.guestIncidentTrigger.js
--    Function name: guestIncidentTrigger
--    Source keyspace: voyageops.guests.incidents
--    Metadata keyspace: voyageops.eventing.sysdata
--    Bucket bindings:
--      - Alias src -> voyageops.guests.incidents (read-only)
--      - Alias dst -> voyageops.agent.agent_runs (read-write)

-- 2) Incident Timestamp Maintainer
--    Handler code: database/eventing.incidentTimestamps.js
--    Function name: incidentTimestamps
--    Source keyspace: voyageops.guests.incidents
--    Metadata keyspace: voyageops.eventing.sysdata
--    Bucket bindings:
--      - Alias src -> voyageops.guests.incidents (read-write)
--      - Alias dst -> voyageops.guests.incidents (read-write)

-- Suggested deploy order:
--   1. Deploy incidentTimestamps first.
--   2. Deploy guestIncidentTrigger second.

