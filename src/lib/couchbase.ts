import { connect, Cluster, Collection } from 'couchbase';

let cluster: Cluster | null = null;
let bucket: any = null;

export async function initCouchbase() {
  if (cluster) return; // Already initialized

  const endpoint = process.env.COUCHBASE_ENDPOINT!;
  const username = process.env.COUCHBASE_USER!;
  const password = process.env.COUCHBASE_PASSWORD!;
  const bucketName = process.env.COUCHBASE_BUCKET || 'voyageops';

  if (!endpoint || !username || !password) {
    throw new Error('Missing Couchbase env vars');
  }

  cluster = await connect(endpoint, {
    username,
    password,
    configProfile: 'wanDevelopment',
  });

  bucket = cluster.bucket(bucketName);
}

export const db = {
  get cluster() {
    if (!cluster) throw new Error('Couchbase not initialized. Call initCouchbase() first.');
    return cluster;
  },
  get bucket() {
    if (!bucket) throw new Error('Couchbase not initialized. Call initCouchbase() first.');
    return bucket;
  },
  get guests() {
    return this.bucket.scope('guests').collection('guests');
  },
  get bookings() {
    return this.bucket.scope('guests').collection('bookings');
  },
  get incidents() {
    return this.bucket.scope('guests').collection('incidents');
  },
  get excursions() {
    return this.bucket.scope('excursions').collection('excursions');
  },
  get venues() {
    return this.bucket.scope('operations').collection('venues');
  },
  get recommendations() {
    return this.bucket.scope('intelligence').collection('recommendations');
  },
  get timeline() {
    return this.bucket.scope('intelligence').collection('timeline_events');
  },
  get kpis() {
    return this.bucket.scope('intelligence').collection('kpis');
  },
  get shipInfo() {
    return this.bucket.scope('intelligence').collection('ship_info');
  }
};