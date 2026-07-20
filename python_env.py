from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values


def find_repo_root(start_path: Path | None = None) -> Path:
    current = (start_path or Path(__file__)).resolve()
    if current.is_file():
        current = current.parent

    for candidate in (current, *current.parents):
        if (candidate / ".env").exists():
            return candidate

    return Path(__file__).resolve().parent


def load_repo_env(start_path: Path | None = None) -> None:
    repo_root = find_repo_root(start_path)
    env_path = repo_root / ".env"

    if not env_path.exists():
        return

    # dotenv_values handles quoting and ${VAR} interpolation (e.g. AGENT_CATALOG_CONN_STRING=${COUCHBASE_ENDPOINT}),
    # which a hand-rolled split-on-"=" parser cannot.
    for key, value in dotenv_values(env_path).items():
        if key and value is not None:
            os.environ.setdefault(key, value)

    _default_agent_catalog_root_certificate()


def _default_agent_catalog_root_certificate() -> None:
    """agentc requires AGENT_CATALOG_CONN_ROOT_CERTIFICATE for couchbases:// connections.

    Capella certificates are signed by a public CA, so the standard certifi bundle validates
    fine — fall back to it instead of requiring every developer to download a cluster cert.
    """
    if os.environ.get("AGENT_CATALOG_CONN_ROOT_CERTIFICATE"):
        return
    if not os.environ.get("AGENT_CATALOG_CONN_STRING", "").startswith("couchbases://"):
        return
    try:
        import certifi
    except ImportError:
        return
    os.environ.setdefault("AGENT_CATALOG_CONN_ROOT_CERTIFICATE", certifi.where())


def get_env(name: str, *, default: str | None = None, aliases: tuple[str, ...] = ()) -> str | None:
    for candidate in (name, *aliases):
        value = os.getenv(candidate)
        if value:
            return value
    return default


def get_required_env(name: str, *, aliases: tuple[str, ...] = ()) -> str:
    value = get_env(name, aliases=aliases)
    if not value:
        alias_text = f" (aliases: {', '.join(aliases)})" if aliases else ""
        raise RuntimeError(f"Missing required environment variable: {name}{alias_text}")
    return value