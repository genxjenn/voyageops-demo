import os
import sys
import time
from pathlib import Path

from couchbase.options import QueryOptions

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python_env import load_repo_env
from guest_recovery_worker import AgentWorkerError, create_cluster, get_settings, run_guest_recovery_agent


def fetch_pending_run_ids(cluster, limit: int) -> list[str]:
    query = """
    SELECT META(r).id AS runId
    FROM voyageops.agent.agent_runs r
    WHERE r.status = $status
    ORDER BY r.createdAt ASC
    LIMIT $limit
    """
    result = cluster.query(
        query,
        QueryOptions(
            named_parameters={
                "status": "pending",
                "limit": limit,
            }
        ),
    )
    return [str(row["runId"]) for row in result.rows() if row.get("runId")]


def main() -> None:
    load_repo_env(REPO_ROOT)

    poll_seconds = float(os.getenv("GUEST_RECOVERY_POLL_SECONDS", "3"))
    batch_size = int(os.getenv("GUEST_RECOVERY_POLL_BATCH_SIZE", "10"))

    settings = get_settings()
    cluster = create_cluster(settings)

    print(
        f"Guest Recovery worker loop started (poll={poll_seconds}s, batch={batch_size}, bucket={settings.couchbase_bucket})"
    )

    try:
        while True:
            try:
                run_ids = fetch_pending_run_ids(cluster, batch_size)
            except Exception as error:
                print(f"Failed to query pending runs: {error}")
                time.sleep(poll_seconds)
                continue

            if not run_ids:
                time.sleep(poll_seconds)
                continue

            print(f"Found {len(run_ids)} pending run(s)")

            for run_id in run_ids:
                try:
                    result = run_guest_recovery_agent(run_id)
                    print(f"Completed run {run_id} -> proposal {result.get('proposalId')}")
                except AgentWorkerError as error:
                    print(f"Run {run_id} failed at step '{error.step}': {error.message}")
                except Exception as error:
                    print(f"Run {run_id} failed with unexpected error: {error}")

            time.sleep(poll_seconds)
    except KeyboardInterrupt:
        print("Guest Recovery worker loop stopped")


if __name__ == "__main__":
    main()