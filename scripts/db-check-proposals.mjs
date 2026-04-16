import 'dotenv/config';
import couchbase from 'couchbase';

const endpoint = process.env.COUCHBASE_ENDPOINT;
const user = process.env.COUCHBASE_USER;
const pass = process.env.COUCHBASE_PASSWORD;
const bucket = process.env.COUCHBASE_BUCKET || 'voyageops';

const cluster = await couchbase.connect(endpoint, { username: user, password: pass });

const q1 = await cluster.query(
  `SELECT RAW {"status": r.status, "count": COUNT(1)} FROM \`${bucket}\`.agent.agent_runs r GROUP BY r.status`
);
const q2 = await cluster.query(
  `SELECT RAW COUNT(1) FROM \`${bucket}\`.agent.action_proposals p`
);
const q3 = await cluster.query(
  `SELECT RAW COUNT(1)
   FROM (
     SELECT p.guestId, p.incidentId, COUNT(1) AS c
     FROM \`${bucket}\`.agent.action_proposals p
     GROUP BY p.guestId, p.incidentId
     HAVING COUNT(1) > 1
   ) d`
);
const q4 = await cluster.query(
  `SELECT p.guestId, p.incidentId, COUNT(1) AS proposalCount, ARRAY_AGG(META(p).id) AS proposalIds
   FROM \`${bucket}\`.agent.action_proposals p
   GROUP BY p.guestId, p.incidentId
   HAVING COUNT(1) > 1
   LIMIT 10`
);

console.log('agent_runs by status:', q1.rows);
console.log('action_proposals total:', q2.rows[0]);
console.log('duplicate guest+incident groups:', q3.rows[0]);
console.log('sample duplicates:', q4.rows);

await cluster.close();
