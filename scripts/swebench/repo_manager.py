from __future__ import annotations

import subprocess
import tempfile
import os
from pathlib import Path
from typing import Tuple


def normalize_repo_url(repo: str) -> str:
    repo = repo.strip()
    if repo.startswith("http://") or repo.startswith("https://"):
        return repo
    if repo.endswith(".git"):
        return f"https://github.com/{repo}"
    return f"https://github.com/{repo}.git"


def _run_git(args: list[str], cwd: Path | None = None, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    env.setdefault("GIT_ASKPASS", "echo")
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd) if cwd else None,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        check=False,
        env=env,
    )


def clone_and_checkout(repo: str, base_commit: str, target_dir: Path, timeout_sec: int = 300) -> None:
    repo_url = normalize_repo_url(repo)
    target_dir.mkdir(parents=True, exist_ok=True)

    init = _run_git(["init"], cwd=target_dir, timeout=60)
    if init.returncode != 0:
        raise RuntimeError(f"git init failed: {init.stderr or init.stdout}")

    remote = _run_git(["remote", "add", "origin", repo_url], cwd=target_dir, timeout=30)
    if remote.returncode != 0:
        raise RuntimeError(f"git remote add failed: {remote.stderr or remote.stdout}")

    # Fast path: fetch only the exact commit required by SWE-Bench.
    fetch = _run_git(
        ["fetch", "--depth", "1", "--filter=blob:none", "--no-tags", "origin", base_commit],
        cwd=target_dir,
        timeout=timeout_sec,
    )
    if fetch.returncode != 0:
        # Fallback: fetch default branch head in case server refuses commit-only fetch.
        fetch_fallback = _run_git(
            ["fetch", "--depth", "1", "--filter=blob:none", "--no-tags", "origin"],
            cwd=target_dir,
            timeout=timeout_sec,
        )
        if fetch_fallback.returncode != 0:
            raise RuntimeError(
                f"git fetch failed: {fetch.stderr or fetch.stdout}\n"
                f"fallback failed: {fetch_fallback.stderr or fetch_fallback.stdout}"
            )

    checkout = _run_git(["checkout", "--detach", base_commit], cwd=target_dir, timeout=120)
    if checkout.returncode != 0:
        checkout_head = _run_git(["checkout", "--detach", "FETCH_HEAD"], cwd=target_dir, timeout=120)
        if checkout_head.returncode != 0:
            raise RuntimeError(
                f"git checkout failed: {checkout.stderr or checkout.stdout}\n"
                f"checkout FETCH_HEAD failed: {checkout_head.stderr or checkout_head.stdout}"
            )


def extract_patch(repo_dir: Path) -> str:
    diff = _run_git(["diff", "HEAD"], cwd=repo_dir, timeout=60)
    if diff.returncode != 0:
        raise RuntimeError(f"git diff failed: {diff.stderr or diff.stdout}")
    return diff.stdout


def validate_patch(repo_dir: Path, patch_text: str) -> Tuple[bool, str]:
    if not patch_text.strip():
        return False, "empty_patch"

    with tempfile.NamedTemporaryFile("w", suffix=".diff", delete=False, encoding="utf-8") as f:
        f.write(patch_text)
        patch_file = Path(f.name)

    try:
        # Validate against index/base commit without mutating tracked files.
        check = _run_git(["apply", "--check", "--cached", str(patch_file)], cwd=repo_dir, timeout=60)
        if check.returncode == 0:
            return True, ""
        return False, (check.stderr or check.stdout or "git apply --check failed").strip()
    finally:
        patch_file.unlink(missing_ok=True)
