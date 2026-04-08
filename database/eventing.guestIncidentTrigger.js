// Author: jenn.lewis@couchbase.com

// VoyageOps Demo Guest Incident Recovery Agent Trigger:

// 1. Monitors voyageops.guests.incidents bucket for newly updated incidents with a status = "open"
// 2. Creates a doc in voyageops.agent.agent_runs with status = "pending"
// 3. Guest Recovery Agent is monitoring voyageops.agent.agent_runs and is triggered
// 
// CONFIG:

// create scope and collection for eventing system data is voyageops bucket if it does not exist yet.
// example is in eventing.sql
//
// ********** Bucket Bindings **********
// src: voyageops.guests.incidents
// dst: voyageops.agent.agent_runs

// ********** cURL Bindings **********

// None

// ********** Constant bindings **********
// 
// 
// Supported field path formats:
// - "fieldName" (top-level field)
// - "parent.child" (nested object field)
// - "parent.child.grandchild" (deeply nested object field)
// - "`field.with.dots`" (field name containing dots, escaped with backquotes)
// - "normal.`field.with.dots`.nested" (mixed normal and escaped field names)
// Note: Only JSON object nesting is supported. Arrays are treated as endpoint values.
//


function OnUpdate(doc, meta) {
  if (!doc || doc.status !== "open") return;
  if (doc.agentRunCreated) return; // guard against duplicate run creation

  var runId = meta.id + "_run";
  dst[runId] = {
    runId: runId,
    agentType: "guest-recovery",
    guestId: doc.guestId,
    incidentId: meta.id,
    status: "pending",
    query: doc.description || "",
    startedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function OnDelete(meta, options) {
  // optional: cleanup or tombstone handling
}
