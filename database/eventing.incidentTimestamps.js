// Author: jenn.lewis@couchbase.com

// VoyageOps Demo Incident Timestamp Maintainer
//
// Behavior:
// 1) On first insert, sets both createdAt and updatedAt to current UTC timestamp.
// 2) On every subsequent mutation, refreshes updatedAt to current UTC timestamp.
//
// Notes:
// - Bind the incidents collection as a read/write bucket alias named src.
// - This function writes back to the same source document.
// - Timestamp precision is seconds to keep writes idempotent and avoid rapid
//   re-trigger loops from millisecond differences.
//
// Bucket Bindings:
// src: voyageops.guests.incidents (read/write)

function nowIsoSeconds() {
  var nowMs = Date.now();
  var roundedMs = Math.floor(nowMs / 1000) * 1000;
  return new Date(roundedMs).toISOString();
}

function OnUpdate(doc, meta) {
  if (!doc) return;

  var nowIso = nowIsoSeconds();
  var hasCreatedAt = typeof doc.createdAt === "string" && doc.createdAt.length > 0;

  var nextCreatedAt = hasCreatedAt ? doc.createdAt : nowIso;
  var nextUpdatedAt = nowIso;

  // No-op when already in desired state for this second.
  if (doc.createdAt === nextCreatedAt && doc.updatedAt === nextUpdatedAt) {
    return;
  }

  doc.createdAt = nextCreatedAt;
  doc.updatedAt = nextUpdatedAt;

  src[meta.id] = doc;
}

function OnDelete(meta, options) {
  // No-op
}
