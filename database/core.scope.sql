-- ============================================================================
-- 1) Core App Scopes + Collections
-- ============================================================================

CREATE SCOPE voyageops.guests IF NOT EXISTS;

CREATE COLLECTION voyageops.guests.guests IF NOT EXISTS;
CREATE COLLECTION voyageops.guests.bookings IF NOT EXISTS;
CREATE COLLECTION voyageops.guests.incidents IF NOT EXISTS;

CREATE SCOPE voyageops.excursions IF NOT EXISTS;

CREATE COLLECTION voyageops.excursions.excursions IF NOT EXISTS;

CREATE SCOPE voyageops.operations IF NOT EXISTS;

CREATE COLLECTION voyageops.operations.venues IF NOT EXISTS;

CREATE SCOPE voyageops.intelligence IF NOT EXISTS;

CREATE COLLECTION voyageops.intelligence.recommendations IF NOT EXISTS;
CREATE COLLECTION voyageops.intelligence.timeline_events IF NOT EXISTS;
CREATE COLLECTION voyageops.intelligence.kpis IF NOT EXISTS;
CREATE COLLECTION voyageops.intelligence.ship_info IF NOT EXISTS;

-- ============================================================================
-- 2) Primary Indexes (optional but useful for ad hoc debugging)
-- ============================================================================

CREATE PRIMARY INDEX voCore_pi_guests IF NOT EXISTS
ON voyageops.guests.guests;

CREATE PRIMARY INDEX voCore_pi_bookings IF NOT EXISTS
ON voyageops.guests.bookings;

CREATE PRIMARY INDEX voCore_pi_incidents IF NOT EXISTS
ON voyageops.guests.incidents;

CREATE PRIMARY INDEX voCore_pi_excursions IF NOT EXISTS
ON voyageops.excursions.excursions;

CREATE PRIMARY INDEX voCore_pi_venues IF NOT EXISTS
ON voyageops.operations.venues;

CREATE PRIMARY INDEX voCore_pi_recommendations IF NOT EXISTS
ON voyageops.intelligence.recommendations;

CREATE PRIMARY INDEX voCore_pi_timeline_events IF NOT EXISTS
ON voyageops.intelligence.timeline_events;

CREATE PRIMARY INDEX voCore_pi_kpis IF NOT EXISTS
ON voyageops.intelligence.kpis;

CREATE PRIMARY INDEX voCore_pi_ship_info IF NOT EXISTS
ON voyageops.intelligence.ship_info;

CREATE INDEX ix_bookings_guestid_voyage IF NOT EXISTS
ON voyageops.guests.bookings(guestId, voyageNumber);
