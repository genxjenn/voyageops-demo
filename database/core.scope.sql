-- ============================================================================
-- 1) Core App Scopes + Collections
-- ============================================================================

CREATE SCOPE voyageops.guests;

CREATE COLLECTION voyageops.guests.guests;
CREATE COLLECTION voyageops.guests.bookings;
CREATE COLLECTION voyageops.guests.incidents;

CREATE SCOPE voyageops.excursions;

CREATE COLLECTION voyageops.excursions.excursions;

CREATE SCOPE voyageops.operations;

CREATE COLLECTION voyageops.operations.venues;

CREATE SCOPE voyageops.intelligence;

CREATE COLLECTION voyageops.intelligence.recommendations;
CREATE COLLECTION voyageops.intelligence.timeline_events;
CREATE COLLECTION voyageops.intelligence.kpis;
CREATE COLLECTION voyageops.intelligence.ship_info;

-- ============================================================================
-- 2) Primary Indexes (optional but useful for ad hoc debugging)
-- ============================================================================

CREATE PRIMARY INDEX voCore_pi_guests
ON voyageops.guests.guests;

CREATE PRIMARY INDEX voCore_pi_bookings
ON voyageops.guests.bookings;

CREATE PRIMARY INDEX voCore_pi_incidents
ON voyageops.guests.incidents;

CREATE PRIMARY INDEX voCore_pi_excursions
ON voyageops.excursions.excursions;

CREATE PRIMARY INDEX voCore_pi_venues
ON voyageops.operations.venues;

CREATE PRIMARY INDEX voCore_pi_recommendations
ON voyageops.intelligence.recommendations;

CREATE PRIMARY INDEX voCore_pi_timeline_events
ON voyageops.intelligence.timeline_events;

CREATE PRIMARY INDEX voCore_pi_kpis
ON voyageops.intelligence.kpis;

CREATE PRIMARY INDEX voCore_pi_ship_info
ON voyageops.intelligence.ship_info;
