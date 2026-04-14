from __future__ import annotations

import os
from pathlib import Path


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

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


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