from __future__ import annotations

import json
import os
import platform
import subprocess
from datetime import datetime, UTC
from pathlib import Path
from typing import Iterable

from datasets import load_dataset
from datasets.exceptions import DatasetNotFoundError
from tqdm import tqdm

from config import load_config
from gently_adapter import GentlySWEAdapter, SWETask, prediction_as_dict, summary_as_dict


def _ensure_runner_built(repo_root: Path, runner_path: Path) -> None:
    if runner_path.exists():
        return
    print(f"Runner not found at {runner_path}. Building scripts...")
    cmd = ["npm", "run", "build:scripts"]
    res = subprocess.run(cmd, cwd=str(repo_root), text=True, capture_output=True, check=False)
    if res.returncode != 0 or not runner_path.exists():
        raise RuntimeError(
            "Failed to build scripts. "
            f"stdout={res.stdout[-1000:]} stderr={res.stderr[-1000:]}"
        )


def _parse_node_major(version_output: str) -> int:
    value = version_output.strip().lstrip("v")
    major = value.split(".", 1)[0]
    return int(major)


def _is_wsl() -> bool:
    if platform.system().lower() != "linux":
        return False
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8").lower()
    except Exception:
        return False


def _run_preflight_checks(repo_root: Path) -> None:
    # 1) Node version
    node_ver = subprocess.run(["node", "--version"], text=True, capture_output=True, check=False)
    if node_ver.returncode != 0:
        raise RuntimeError(f"Node.js not available in PATH: {node_ver.stderr or node_ver.stdout}")
    try:
        major = _parse_node_major(node_ver.stdout)
    except Exception as exc:
        raise RuntimeError(f"Could not parse node version output: {node_ver.stdout!r}") from exc
    if major < 20:
        raise RuntimeError(
            f"Node.js >=20 required for this runner, found {node_ver.stdout.strip()}. "
            "Upgrade Node in WSL (recommended: Node 22)."
        )

    # 2) WSL/path hints
    cwd = str(repo_root)
    if _is_wsl() and cwd.startswith("/mnt/"):
        print(
            "[Preflight] Warning: running from /mnt/* path. "
            "If you see I/O/perf issues, move repo to ~/Agent for native Linux FS."
        )
    if platform.system().lower() != "linux":
        print("[Preflight] Warning: non-Linux environment detected. WSL/Linux is strongly recommended.")

    # 3) Native module compatibility check
    hnsw_check = subprocess.run(
        ["node", "-e", "require('hnswlib-node'); process.stdout.write('ok')"],
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )
    if hnsw_check.returncode != 0:
        raise RuntimeError(
            "hnswlib-node failed to load in current environment. "
            "Reinstall node modules in WSL/Linux: rm -rf node_modules && npm install && npm run build:scripts. "
            f"stderr={hnsw_check.stderr[-500:]}"
        )


def _run_treesitter_preflight(repo_root: Path, require_treesitter: bool) -> None:
    if not require_treesitter:
        print("[Preflight] Tree-sitter requirement disabled (GENTLY_REQUIRE_TREESITTER=0).")
        return

    ts_dir = repo_root / "resources" / "tree-sitter"
    required_files = [
        "tree-sitter.wasm",
        "tree-sitter-typescript.wasm",
        "tree-sitter-tsx.wasm",
        "tree-sitter-javascript.wasm",
        "tree-sitter-python.wasm",
        "tree-sitter-go.wasm",
        "tree-sitter-rust.wasm",
        "tree-sitter-php.wasm",
        "tree-sitter-html.wasm",
    ]
    missing = [name for name in required_files if not (ts_dir / name).exists()]
    if missing:
        raise RuntimeError(
            "Tree-sitter WASM files missing. Missing: "
            + ", ".join(missing)
            + ". Expected directory: "
            + str(ts_dir)
            + ".\nFix: ensure these files exist (e.g. run the grammar download/build step used by this repo)."
        )

    init_check = subprocess.run(
        [
            "node",
            "-e",
            (
                "const Parser=require('web-tree-sitter');"
                "const wasm=process.argv[1];"
                "Parser.init({locateFile:()=>wasm})"
                ".then(()=>process.stdout.write('ok'))"
                ".catch((e)=>{console.error(String(e));process.exit(3);});"
            ),
            str(ts_dir / "tree-sitter.wasm"),
        ],
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )
    if init_check.returncode != 0:
        raise RuntimeError(
            "Tree-sitter init check failed in Node environment. "
            "Fix: reinstall node modules in WSL/Linux and rebuild scripts. "
            f"stderr={init_check.stderr[-500:]}"
        )


def _parse_instance_ids(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _iter_selected(dataset: Iterable[dict], instance_ids: list[str], smoke_size: int):
    if instance_ids:
        instance_set = set(instance_ids)
        selected = [item for item in dataset if item.get("instance_id") in instance_set]
        return selected
    return list(dataset.select(range(smoke_size)))


def _load_dataset_with_fallback(dataset_name: str, split: str):
    candidates: list[str] = []
    for name in (dataset_name, "ScaleAI/SWE-bench_Pro", "scale/SWE-bench_Pro"):
        if name and name not in candidates:
            candidates.append(name)

    last_error: Exception | None = None
    for name in candidates:
        try:
            print(f"Trying dataset: {name} (split={split})")
            return load_dataset(name, split=split)
        except DatasetNotFoundError as exc:
            last_error = exc
            continue

    tried = ", ".join(candidates)
    raise RuntimeError(
        f"Could not load SWE-Bench Pro dataset. Tried: {tried}. "
        "If needed, set GENTLY_DATASET_NAME to the correct accessible dataset id."
    ) from last_error


def main() -> None:
    config = load_config()
    _ensure_runner_built(config.repo_root, config.runner_js_path)
    _run_preflight_checks(config.repo_root)
    _run_treesitter_preflight(config.repo_root, config.require_treesitter)

    run_id = os.getenv("RUN_ID") or datetime.now(UTC).strftime("run_%Y%m%d_%H%M%S")
    run_dir = config.repo_root / "runs" / run_id
    pred_dir = run_dir / "predictions"
    logs_dir = run_dir / "logs" / "prediction_logs"
    pred_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading dataset: {config.dataset_name} (split={config.dataset_split})")
    dataset = _load_dataset_with_fallback(config.dataset_name, config.dataset_split)

    instance_ids = _parse_instance_ids(config.instance_ids_csv)
    items = _iter_selected(dataset, instance_ids, config.smoke_size)
    print(f"Processing {len(items)} instances")

    adapter = GentlySWEAdapter(config)
    predictions: list[dict] = []
    summaries: list[dict] = []

    for item in tqdm(items, desc="Generating predictions"):
        instance_id = item["instance_id"]
        log_path = logs_dir / f"{instance_id}.jsonl"

        def log_callback(event: dict) -> None:
            with log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=True) + "\n")

        task = SWETask(
            instance_id=instance_id,
            repo=item["repo"],
            base_commit=item["base_commit"],
            problem_statement=item["problem_statement"],
            hints_text=item.get("hints_text"),
        )
        prediction, summary = adapter.process_task(task, log_callback=log_callback)
        predictions.append(prediction_as_dict(prediction))
        summaries.append(summary_as_dict(summary))

    predictions_path = pred_dir / "gently_predictions.json"
    with predictions_path.open("w", encoding="utf-8") as f:
        json.dump(predictions, f, indent=2, ensure_ascii=False)

    summary_path = run_dir / "summary.json"
    success_count = sum(1 for x in summaries if x["status"] == "success")
    report = {
        "run_id": run_id,
        "model": config.model,
        "runner_mode": config.runner_mode,
        "total_instances": len(summaries),
        "success": success_count,
        "failed": len(summaries) - success_count,
        "statuses": {
            "timeout": sum(1 for x in summaries if x["status"] == "timeout"),
            "invalid_patch": sum(1 for x in summaries if x["status"] == "invalid_patch"),
            "no_patch": sum(1 for x in summaries if x["status"] == "no_patch"),
            "infra_error": sum(1 for x in summaries if x["status"] == "infra_error"),
            "success": success_count,
        },
        "predictions_path": str(predictions_path),
    }
    with summary_path.open("w", encoding="utf-8") as f:
        json.dump({"report": report, "instances": summaries}, f, indent=2, ensure_ascii=False)

    print("=" * 60)
    print(f"Run ID: {run_id}")
    print(f"Predictions: {predictions_path}")
    print(f"Summary: {summary_path}")
    print(f"Success: {success_count}/{len(summaries)}")


if __name__ == "__main__":
    main()
