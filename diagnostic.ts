import { initCouchbase, db } from './src/lib/couchbase';
import 'dotenv/config';

async function run() {
  await initCouchbase();
  const runKey = 'IN_IOS-114_237::guest-recovery';
  let runDoc: any = null;

  try {
    const res = await db.agentRuns.get(runKey);
    runDoc = res.content;
    console.log('1) Agent Run found:', JSON.stringify(runDoc, null, 2));
  } catch (e: any) {
    if (e.message.toLowerCase().includes('not found')) {
      console.log(`1) Agent Run ${runKey} not found. Searching...`);
      const query = 'SELECT META().id FROM voyageops.agent.agent_runs WHERE META().id LIKE "%IN_IOS-114_237%"';
      const results = await db.cluster.query(query);
      console.log('Search matches:', results.rows);
    } else {
      console.error('Error fetching agent run:', e);
    }
  }

  let loyaltyTier = '';
  let incidentType = '';

  if (runDoc && runDoc.incidentId) {
    try {
      const incidentRes = await db.incidents.get(runDoc.incidentId);
      const incident = incidentRes.content;
      incidentType = incident.type;
      const guestKey = runDoc.guestId;
      const guestRes = await db.guests.get(guestKey);
      const guest = guestRes.content;
      loyaltyTier = guest.loyaltyTier;
      console.log('2) Context:', { loyaltyTier, incidentType, category: incident.category });
    } catch (e) {
      console.error('Error loading context:', e);
    }
  }

  const pbKey = 'playbooks::pb_gr_maint_failure_vip';
  try {
    const pbRes = await db.playbooks.get(pbKey);
    const pb = pbRes.content;
    console.log('3) Playbook Info:');
    console.log(` - incidentType: ${pb.incidentType}`);
    console.log(` - loyaltyTier: ${pb.loyaltyTier}`);
    console.log(` - actionIds count: ${pb.actionIds?.length}`);
    console.log(` - first 10 actionIds: ${JSON.stringify(pb.actionIds?.slice(0, 10))}`);
    console.log(` - embedding length: ${pb.embedding?.length}`);

    console.log('4) Action Catalog Details:');
    if (pb.actionIds) {
      for (const aid of pb.actionIds) {
        try {
          const actionRes = await db.actionCatalog.get(aid);
          const a = actionRes.content;
          console.log(` - Action ${aid}: found=true, loyaltyTier=${JSON.stringify(a.loyaltyTier)}, active=${a.active}`);
        } catch (e) {
          console.log(` - Action ${aid}: found=false`);
        }
      }
    }

    if (loyaltyTier) {
      const query = "SELECT a.actionId, a.label, a.description, a.estimatedValue, a.incidentCategory, a.incidentType, a.loyaltyTier FROM voyageops.agent.playbooks p UNNEST p.actionIds AS aid JOIN voyageops.agent.action_catalog a ON aid = a.actionId WHERE META(p).id = $playbookId AND ((IS_STRING(a.loyaltyTier) AND LOWER(TRIM(a.loyaltyTier)) IN ['any', $loyaltyTier]) OR (IS_ARRAY(a.loyaltyTier) AND ANY tier IN a.loyaltyTier SATISFIES LOWER(TRIM(tier)) IN ['any', $loyaltyTier] END)) AND a.active = true";
      const tierLower = loyaltyTier.toLowerCase().trim();
      const results = await db.cluster.query(query, { parameters: { playbookId: pbKey, loyaltyTier: tierLower } });
      console.log('5) Eligibility Query Results:');
      console.log(` - Count: ${results.rows.length}`);
      console.log(` - ActionIds: ${JSON.stringify(results.rows.map((r: any) => r.actionId))}`);
    }

  } catch (e) {
    console.error('Error with playbook or actions:', e);
  }

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
