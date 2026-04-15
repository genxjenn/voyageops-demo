"""
Creates the 'voAgentPlaybookOpenAI_vectorIndex' FTS vector search index in
Couchbase Capella and (optionally) re-enqueues failed agent_runs so the
worker can retry them.

Usage:
    python setup_search_index.py              # create index only
    python setup_search_index.py --reenqueue  # create index + reset failed runs
"""

import argparse
import sys
import time
from datetime import timedelta
from pathlib import Path

from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster
from couchbase.exceptions import CouchbaseException
from couchbase.exceptions import CouchbaseException, QueryIndexAlreadyExistsException
from couchbase.management.search import SearchIndex
from couchbase.options import ClusterOptions, QueryOptions
from couchbase.n1ql import QueryScanConsistency

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python_env import get_required_env, load_repo_env

# ── Index definition ──────────────────────────────────────────────────────────
# Global FTS vector index targeting voyageops.agent.playbooks.
# The doc_config mode "scope.collection.type_field" routes documents to the
# correct mapping type ("agent.playbooks") via the per-document "collection"
# field that seed-agent-data.ts writes as "playbooks".
INDEX_PARAMS = {
    "doc_config": {
        "docid_prefix_delim": "",
        "docid_regexp": "",
        "mode": "scope.collection.type_field",
        "type_field": "collection",
    },
    "mapping": {
        "default_analyzer": "standard",
        "default_datetime_parser": "dateTimeOptional",
        "default_field": "_all",
        "default_mapping": {"dynamic": False, "enabled": False},
        "default_type": "_default",
        "docvalues_dynamic": False,
        "index_dynamic": False,
        "store_dynamic": False,
        "type_field": "_type",
        "types": {
            "agent.playbooks": {
                "dynamic": False,
                "enabled": True,
                "properties": {
                    "embedding": {
                        "dynamic": False,
                        "enabled": True,
                        "fields": [
                            {
                                "dims": 1536,
                                "index": True,
                                "name": "embedding",
                                "similarity": "dot_product",
                                "type": "vector",
                                "vector_index_optimized_for": "recall",
                            }
                        ],
                    }
                },
            }
        },
    },
    "store": {"indexType": "scorch", "segmentVersion": 16},
}

INDEX_PLAN_PARAMS = {"maxPartitionsPerPIndex": 1024, "indexPartitions": 1}


def connect(endpoint: str, user: str, password: str) -> Cluster:
    auth = PasswordAuthenticator(user, password)
    cluster = Cluster(endpoint, ClusterOptions(auth))
    cluster.wait_until_ready(timedelta(seconds=15))
    return cluster


def create_index(cluster: Cluster, bucket: str, index_name: str) -> None:
    si = SearchIndex(
        name=index_name,
        idx_type="fulltext-index",
        source_name=bucket,
        source_type="gocbcore",
        params=INDEX_PARAMS,
        plan_params=INDEX_PLAN_PARAMS,
        source_params={},
    )
    try:
        cluster.search_indexes().upsert_index(si)
        print(f"[OK] Created index '{index_name}' on bucket '{bucket}'")
    except QueryIndexAlreadyExistsException:
        print(f"[OK] Index '{index_name}' already exists — skipping creation")


def wait_for_index(cluster: Cluster, index_name: str, timeout: int = 60) -> bool:
    """Poll until the index is visible in get_all_indexes()."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            names = {idx.name for idx in cluster.search_indexes().get_all_indexes()}
            if index_name in names:
                return True
        except CouchbaseException:
            pass
        time.sleep(2)
    return False


def reenqueue_failed_runs(cluster: Cluster) -> int:
    """Reset failed playbook_search runs to pending so the worker retries."""
    sql = """
    UPDATE voyageops.agent.agent_runs AS r
    SET r.status = "pending",
        r.lastProcessedStep = "requeued",
        r.lastError = null,
        r.updatedAt = NOW_STR()
    WHERE r.status = "failed"
      AND r.lastError.step = "playbook_search"
    RETURNING META(r).id
    """
    result = cluster.query(sql, QueryOptions(scan_consistency=QueryScanConsistency.REQUEST_PLUS))
    rows = list(result.rows())
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create FTS playbook vector index")
    parser.add_argument(
        "--reenqueue",
        action="store_true",
        help="Also reset failed playbook_search runs to pending",
    )
    args = parser.parse_args()

    load_repo_env(REPO_ROOT)
    endpoint = get_required_env("COUCHBASE_ENDPOINT")
    user = get_required_env("COUCHBASE_USER")
    password = get_required_env("COUCHBASE_PASSWORD")
    bucket = get_required_env("COUCHBASE_BUCKET") if "COUCHBASE_BUCKET" in __import__("os").environ else "voyageops"
    index_name = __import__("os").getenv("CB_PLAYBOOK_VECTOR_INDEX", "vector_playbook_idx")

    print(f"Connecting to {endpoint} ...")
    cluster = connect(endpoint, user, password)
    print("[OK] Connected")

    create_index(cluster, bucket, index_name)

    print(f"Waiting for '{index_name}' to become visible ...")
    if wait_for_index(cluster, index_name, timeout=60):
        print(f"[OK] Index '{index_name}' is live")
    else:
        print(f"[WARN] Index not yet visible after 60 s — it may still be building in the background")

    if args.reenqueue:
        count = reenqueue_failed_runs(cluster)
        print(f"[OK] Re-enqueued {count} failed run(s) as pending")
    else:
        print("\nTip: run with --reenqueue to reset all failed playbook_search runs back to pending")


if __name__ == "__main__":
    main()
