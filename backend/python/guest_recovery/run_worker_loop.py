import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from couchbase.options import QueryOptions

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python_env import load_repo_env
from guest_recovery_worker import AgentWorkerError, create_cluster, get_settings, run_guest_recovery_agent

PID_FILE = REPO_ROOT / ".worker.pid"


def _post_log(level: str, message: str, **extra: object) -> None:
    """Fire-and-forget POST to the API worker-logs endpoint. Never blocks or raises."""
    api_url = os.getenv("WORKER_API_URL", "http://localhost:5173")
    endpoint = f"{api_url}/api/worker-logs"
    payload = json.dumps({"level": level, "message": message, **extra}).encode()

    def _send() -> None:
        try:
            req = urllib.request.Request(
                endpoint,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass  # API not available — log silently dropped

    threading.Thread(target=_send, daemon=True).start()


def log(level: str, message: str, **extra: object) -> None:
    """Print to stdout and push to the UI activity stream."""
    print(message)
    _post_log(level, message, **extra)


def _acquire_pid_file() -> None:
    """Exit immediately if another worker instance is already running."""
    if PID_FILE.exists():
        existing_pid = PID_FILE.read_text().strip()
        try:
            # Signal 0 checks whether the process is alive without sending a real signal.
            os.kill(int(existing_pid), 0)
            print(
                f"ERROR: Worker already running (PID {existing_pid}). "
                "Stop it first or delete {PID_FILE} if it is stale."
            )
            sys.exit(1)
        except (ProcessLookupError, ValueError):
            # Stale PID file — previous run did not clean up.
            PID_FILE.unlink(missing_ok=True)

    PID_FILE.write_text(str(os.getpid()))


def _release_pid_file() -> None:
    PID_FILE.unlink(missing_ok=True)


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

    _acquire_pid_file()

    # Ensure PID file is removed on SIGTERM as well as normal exit.
    def _handle_sigterm(signum, frame):  # noqa: ANN001
        _release_pid_file()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)

    poll_seconds = float(os.getenv("GUEST_RECOVERY_POLL_SECONDS", "3"))
    batch_size = int(os.getenv("GUEST_RECOVERY_POLL_BATCH_SIZE", "10"))

    settings = get_settings()
    cluster = create_cluster(settings)

    log(
        "info",
        f"Guest Recovery worker loop started (PID {os.getpid()}, poll={poll_seconds}s, "
        f"batch={batch_size}, bucket={settings.couchbase_bucket})",
    )

    try:
        while True:
            try:
                run_ids = fetch_pending_run_ids(cluster, batch_size)
            except Exception as error:
                log("error", f"Failed to query pending runs: {error}")
                time.sleep(poll_seconds)
                continue

            if not run_ids:
                time.sleep(poll_seconds)
                continue

            log("info", f"Found {len(run_ids)} pending run(s)")

            for run_id in run_ids:
                try:
                    log("info", f"Processing run {run_id}…", runId=run_id, step="started")
                    result = run_guest_recovery_agent(run_id)
                    log(
                        "success",
                        f"Completed run {run_id} → proposal {result.get('proposalId')}",
                        runId=run_id,
                        proposalId=result.get("proposalId", ""),
                        step="write_proposal",
                    )
                except AgentWorkerError as error:
                    log(
                        "error",
                        f"Run {run_id} failed at step '{error.step}': {error.message}",
                        runId=run_id,
                        step=error.step,
                    )
                except Exception as error:
                    log("error", f"Run {run_id} failed with unexpected error: {error}", runId=run_id)

            time.sleep(poll_seconds)
    except KeyboardInterrupt:
        log("info", "Guest Recovery worker loop stopped")
    finally:
        _release_pid_file()


if __name__ == "__main__":
    main()