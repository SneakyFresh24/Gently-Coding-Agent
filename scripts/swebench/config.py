from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class BenchmarkConfig:
    repo_root: Path
    openrouter_api_key: str
    model: str
    max_tokens: int = 8192
    temperature: float = 0.0
    timeout_sec: int = 1800
    smoke_size: int = 10
    max_workers: int = 4
    retry_max: int = 2
    retry_backoff_sec: int = 3
    instance_ids_csv: Optional[str] = None
    dataset_name: str = "ScaleAI/SWE-bench_Pro"
    dataset_split: str = "test"
    context_window_tokens: int = 204800
    soft_trim_ratio: float = 0.70
    hard_trim_ratio: float = 0.85
    output_reserve_ratio: float = 0.15
    safety_reserve_ratio: float = 0.05
    runner_mode: str = "gently_core_full_parity"
    verification_model: Optional[str] = None
    require_treesitter: bool = True

    @property
    def runner_js_path(self) -> Path:
        return self.repo_root / "out" / "scripts" / "scripts" / "swebench" / "gently_core_runner.js"


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        # Shell environment takes precedence if already set.
        os.environ.setdefault(key, value)


def load_config() -> BenchmarkConfig:
    repo_root = Path(__file__).resolve().parents[2]
    _load_env_file(repo_root / ".env.swebench.local")
    _load_env_file(repo_root / ".env")
    return BenchmarkConfig(
        repo_root=repo_root,
        openrouter_api_key=_required_env("OPENROUTER_API_KEY"),
        model=_required_env("GENTLY_MODEL"),
        max_tokens=int(os.getenv("GENTLY_MAX_TOKENS", "8192")),
        temperature=float(os.getenv("GENTLY_TEMPERATURE", "0.0")),
        timeout_sec=int(os.getenv("GENTLY_TIMEOUT_SEC", "1800")),
        smoke_size=int(os.getenv("GENTLY_SMOKE_SIZE", "10")),
        max_workers=int(os.getenv("GENTLY_MAX_WORKERS", "4")),
        retry_max=int(os.getenv("GENTLY_RETRY_MAX", "2")),
        retry_backoff_sec=int(os.getenv("GENTLY_RETRY_BACKOFF_SEC", "3")),
        instance_ids_csv=os.getenv("GENTLY_INSTANCE_IDS"),
        dataset_name=os.getenv("GENTLY_DATASET_NAME", "ScaleAI/SWE-bench_Pro"),
        dataset_split=os.getenv("GENTLY_DATASET_SPLIT", "test"),
        context_window_tokens=int(os.getenv("GENTLY_CONTEXT_WINDOW_TOKENS", "204800")),
        soft_trim_ratio=float(os.getenv("GENTLY_SOFT_TRIM_RATIO", "0.70")),
        hard_trim_ratio=float(os.getenv("GENTLY_HARD_TRIM_RATIO", "0.85")),
        output_reserve_ratio=float(os.getenv("GENTLY_OUTPUT_RESERVE_RATIO", "0.15")),
        safety_reserve_ratio=float(os.getenv("GENTLY_SAFETY_RESERVE_RATIO", "0.05")),
        runner_mode=os.getenv("GENTLY_RUNNER_MODE", "gently_core_full_parity"),
        verification_model=os.getenv("GENTLY_VERIFICATION_MODEL"),
        require_treesitter=os.getenv("GENTLY_REQUIRE_TREESITTER", "1").strip().lower() not in {"0", "false", "no"},
    )
