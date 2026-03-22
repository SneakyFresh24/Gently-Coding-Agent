from __future__ import annotations

import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from config import BenchmarkConfig
from repo_manager import clone_and_checkout, validate_patch


@dataclass
class SWETask:
    instance_id: str
    repo: str
    base_commit: str
    problem_statement: str
    hints_text: Optional[str] = None


@dataclass
class Prediction:
    instance_id: str
    model_patch: str
    model_name_or_path: str = "Gently"


@dataclass
class PredictionLog:
    instance_id: str
    timestamp: str
    status: str
    patch_length: int = 0
    error_message: Optional[str] = None
    duration_seconds: float = 0.0
    retries: int = 0
    steps_completed: int = 0
    usage: Optional[dict[str, Any]] = None


LogCallback = Optional[Callable[[dict[str, Any]], None]]
RUNNER_EVENT_PREFIX = "RUNNER_EVENT "


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_transient_error(text: str) -> bool:
    lowered = text.lower()
    transient_markers = [
        "openrouter_http_429",
        "rate limit",
        "openrouter_http_500",
        "openrouter_http_502",
        "openrouter_http_503",
        "openrouter_http_504",
        "etimedout",
        "econnreset",
        "temporarily unavailable",
    ]
    return any(marker in lowered for marker in transient_markers)


def _is_context_overflow_error(text: str) -> bool:
    lowered = text.lower()
    markers = [
        "maximum context length",
        "max context length",
        "context_length_exceeded",
        "input exceeds context",
        "requested too many tokens",
    ]
    if any(marker in lowered for marker in markers):
        return True
    if "requested" in lowered and "tokens" in lowered and ("maximum" in lowered or "max" in lowered):
        return True
    return False


def _extract_last_json_from_stdout(stdout: str) -> Optional[dict[str, Any]]:
    """
    Extract the last valid JSON object from mixed stdout (logs + json).
    """
    if not stdout:
        return None

    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        if not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _extract_runner_event(stderr_line: str) -> Optional[dict[str, Any]]:
    line = stderr_line.strip()
    if not line.startswith(RUNNER_EVENT_PREFIX):
        return None
    payload = line[len(RUNNER_EVENT_PREFIX):].strip()
    if not payload:
        return None
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


class GentlySWEAdapter:
    def __init__(self, config: BenchmarkConfig):
        self.config = config

    def _emit(
        self,
        cb: LogCallback,
        instance_id: str,
        step: str,
        status: str,
        message: str,
        error: Optional[str] = None,
        **extra: Any,
    ) -> None:
        if not cb:
            return
        event = {
            "timestamp": _utc_now(),
            "instance_id": instance_id,
            "step": step,
            "status": status,
            "message": message,
            "error": error,
        }
        if extra:
            event.update(extra)
        cb(event)

    def process_task(self, task: SWETask, log_callback: LogCallback = None) -> tuple[Prediction, PredictionLog]:
        started = time.time()
        retries = 0
        summary = PredictionLog(instance_id=task.instance_id, timestamp=_utc_now(), status="infra_error")
        patch = ""

        self._emit(log_callback, task.instance_id, "start", "info", "Task processing started")

        try:
            with tempfile.TemporaryDirectory(prefix=f"swebench_{task.instance_id}_") as repo_tmp:
                repo_dir = Path(repo_tmp)
                self._emit(log_callback, task.instance_id, "clone", "info", f"Cloning {task.repo}")
                clone_and_checkout(task.repo, task.base_commit, repo_dir, timeout_sec=300)
                self._emit(log_callback, task.instance_id, "clone", "success", "Repository ready at base commit")

                runner_payload = self._build_problem_payload(task)
                max_attempts = self.config.retry_max + 1

                runner_status = "infra_error"
                runner_error: Optional[str] = None
                runner_steps = 0
                runner_usage: Optional[dict[str, Any]] = None
                run_max_tokens = self.config.max_tokens
                while retries < max_attempts:
                    self._emit(log_callback, task.instance_id, "runner", "info", "Runner started")
                    result = self._run_gently(
                        repo_dir,
                        runner_payload,
                        task.instance_id,
                        max_tokens=run_max_tokens,
                        log_callback=log_callback,
                    )
                    status = str(result.get("status", "infra_error"))
                    error = str(result.get("error") or "")
                    runner_steps = int(result.get("steps_completed") or 0)
                    usage = result.get("usage")
                    runner_usage = usage if isinstance(usage, dict) else None
                    runner_status = status
                    runner_error = error or None
                    self._emit(log_callback, task.instance_id, "runner", status, "Runner completed", runner_error)

                    if status in ("success", "no_patch", "invalid_patch", "timeout"):
                        patch = str(result.get("patch") or "")
                        break

                    if retries + 1 < max_attempts and _is_context_overflow_error(error):
                        retries += 1
                        run_max_tokens = max(512, run_max_tokens // 2)
                        runner_payload = self._build_problem_payload(
                            task,
                            trim_problem_chars=max(8_000, 64_000 - retries * 16_000),
                            hints_max_chars=max(500, 4_000 - retries * 1_000),
                        )
                        self._emit(
                            log_callback,
                            task.instance_id,
                            "retry",
                            "warn",
                            f"Context overflow detected, retrying with max_tokens={run_max_tokens}",
                            error,
                        )
                        continue

                    if retries + 1 >= max_attempts or not _is_transient_error(error):
                        patch = ""
                        break

                    retries += 1
                    sleep_s = self.config.retry_backoff_sec * retries
                    self._emit(
                        log_callback,
                        task.instance_id,
                        "retry",
                        "warn",
                        f"Transient runner error, retrying in {sleep_s}s (attempt {retries}/{self.config.retry_max})",
                        error,
                    )
                    time.sleep(sleep_s)

                if patch:
                    valid, reason = validate_patch(repo_dir, patch)
                    if not valid:
                        self._emit(log_callback, task.instance_id, "validate_patch", "error", "Patch validation failed", reason)
                        summary.status = "invalid_patch"
                        summary.error_message = reason
                        patch = ""
                    else:
                        self._emit(log_callback, task.instance_id, "validate_patch", "success", "Patch validation passed")
                        summary.status = "success"
                else:
                    if runner_status == "timeout":
                        summary.status = "timeout"
                        summary.error_message = runner_error or f"Task timed out after {self.config.timeout_sec}s"
                    elif runner_status == "invalid_patch":
                        summary.status = "invalid_patch"
                        summary.error_message = runner_error or "Runner produced invalid patch"
                    elif runner_status == "no_patch":
                        summary.status = "no_patch"
                        summary.error_message = runner_error or "No effective code diff generated"
                    else:
                        summary.status = "infra_error"
                        summary.error_message = runner_error or "No patch generated"
                    patch_event_status = "no_patch" if summary.status == "no_patch" else "error"
                    patch_event_message = (
                        "No effective code diff generated"
                        if summary.status == "no_patch"
                        else "No patch generated"
                    )
                    self._emit(
                        log_callback,
                        task.instance_id,
                        "patch",
                        patch_event_status,
                        patch_event_message,
                        summary.error_message,
                    )

                summary.steps_completed = runner_steps
                summary.usage = runner_usage

        except subprocess.TimeoutExpired:
            summary.status = "timeout"
            summary.error_message = f"Task timed out after {self.config.timeout_sec}s"
            self._emit(log_callback, task.instance_id, "timeout", "error", summary.error_message, summary.error_message)
        except Exception as exc:  # noqa: BLE001
            summary.status = "infra_error"
            summary.error_message = str(exc)
            self._emit(log_callback, task.instance_id, "error", "error", "Unhandled exception in adapter", summary.error_message)

        summary.patch_length = len(patch)
        summary.duration_seconds = round(time.time() - started, 3)
        summary.retries = retries

        prediction = Prediction(
            instance_id=task.instance_id,
            model_patch=patch,
            model_name_or_path=f"Gently/{self.config.model}",
        )
        self._emit(
            log_callback,
            task.instance_id,
            "end",
            summary.status,
            "Task processing finished",
            summary.error_message,
            duration_seconds=summary.duration_seconds,
            usage=summary.usage,
            steps_completed=summary.steps_completed,
            retries=summary.retries,
        )
        return prediction, summary

    def _build_problem_payload(
        self,
        task: SWETask,
        trim_problem_chars: int = 64_000,
        hints_max_chars: int = 4_000,
    ) -> str:
        problem = task.problem_statement.strip()
        if len(problem) > trim_problem_chars:
            problem = (
                problem[:trim_problem_chars]
                + "\n\n[Truncated by runner due to context limits. Focus on issue-relevant files and tests.]"
            )

        parts = [f"Instance: {task.instance_id}", "", "Problem Statement:", problem]
        if task.hints_text:
            hints = task.hints_text.strip()
            if len(hints) > hints_max_chars:
                hints = hints[:hints_max_chars] + "\n[Hints truncated]"
            parts.extend(["", "Hints:", hints])
        return "\n".join(parts).strip() + "\n"

    def _run_gently(
        self,
        repo_dir: Path,
        problem_payload: str,
        instance_id: str,
        max_tokens: int,
        log_callback: LogCallback = None,
    ) -> dict[str, Any]:
        runner = self.config.runner_js_path
        if not runner.exists():
            raise FileNotFoundError(
                f"Runner not found: {runner}. Build first with `npm run build:scripts`."
            )

        with tempfile.NamedTemporaryFile("w", suffix=f"_{instance_id}.txt", delete=False, encoding="utf-8") as f:
            f.write(problem_payload)
            problem_file = Path(f.name)

        try:
            cmd = [
                "node",
                str(runner),
                "--repo_dir",
                str(repo_dir),
                "--problem_file",
                str(problem_file),
                "--model",
                self.config.model,
                "--max_tokens",
                str(max_tokens),
                "--temperature",
                str(self.config.temperature),
                "--timeout_sec",
                str(self.config.timeout_sec),
                "--context_window_tokens",
                str(self.config.context_window_tokens),
                "--soft_trim_ratio",
                str(self.config.soft_trim_ratio),
                "--hard_trim_ratio",
                str(self.config.hard_trim_ratio),
                "--output_reserve_ratio",
                str(self.config.output_reserve_ratio),
                "--safety_reserve_ratio",
                str(self.config.safety_reserve_ratio),
                "--runner_mode",
                str(self.config.runner_mode),
                "--verification_model",
                str(self.config.verification_model or self.config.model),
                "--require_treesitter",
                "1" if self.config.require_treesitter else "0",
            ]

            env = os.environ.copy()
            env["OPENROUTER_API_KEY"] = self.config.openrouter_api_key
            proc = subprocess.Popen(
                cmd,
                cwd=str(self.config.repo_root),
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )

            line_queue: queue.Queue[tuple[str, str]] = queue.Queue()
            stdout_lines: list[str] = []
            stderr_lines: list[str] = []

            def _pump(stream_name: str, stream) -> None:  # type: ignore[no-untyped-def]
                try:
                    for raw in iter(stream.readline, ""):
                        line_queue.put((stream_name, raw))
                finally:
                    try:
                        stream.close()
                    except Exception:
                        pass

            t_out = threading.Thread(target=_pump, args=("stdout", proc.stdout), daemon=True)
            t_err = threading.Thread(target=_pump, args=("stderr", proc.stderr), daemon=True)
            t_out.start()
            t_err.start()

            started = time.time()
            heartbeat_interval = 30
            deadline_sec = self.config.timeout_sec + 60
            next_heartbeat = started + heartbeat_interval
            stdout = ""
            stderr = ""

            def _drain_queue() -> None:
                while True:
                    try:
                        stream_name, raw = line_queue.get_nowait()
                    except queue.Empty:
                        break
                    if stream_name == "stdout":
                        stdout_lines.append(raw)
                    else:
                        stderr_lines.append(raw)
                        evt = _extract_runner_event(raw)
                        if evt:
                            step = str(evt.get("step", "runner_event"))
                            status = str(evt.get("status", "info"))
                            message = str(evt.get("message", "Runner event"))
                            error = evt.get("error")
                            extra = {k: v for k, v in evt.items() if k not in {"step", "status", "message", "error"}}
                            self._emit(
                                log_callback,
                                instance_id,
                                step,
                                status,
                                message,
                                str(error) if error is not None else None,
                                **extra,
                            )

            while True:
                if proc.poll() is not None:
                    _drain_queue()
                    break
                _drain_queue()
                elapsed = int(time.time() - started)
                if time.time() >= next_heartbeat:
                    self._emit(
                        log_callback,
                        instance_id,
                        "runner_heartbeat",
                        "info",
                        f"Runner still active after {elapsed}s",
                    )
                    next_heartbeat = time.time() + heartbeat_interval
                if elapsed >= deadline_sec:
                    proc.kill()
                    t_out.join(timeout=2)
                    t_err.join(timeout=2)
                    _drain_queue()
                    stdout = "".join(stdout_lines).strip()
                    stderr = "".join(stderr_lines).strip()
                    return {
                        "status": "timeout",
                        "patch": "",
                        "error": f"runner_timeout_after_{deadline_sec}s: {stderr or stdout}",
                        "usage": None,
                        "steps_completed": 0,
                    }
                time.sleep(1)

            t_out.join(timeout=2)
            t_err.join(timeout=2)
            _drain_queue()
            stdout = "".join(stdout_lines).strip()
            stderr = "".join(stderr_lines).strip()


            if proc.returncode != 0:
                return {
                    "status": "infra_error",
                    "patch": "",
                    "error": f"runner_exit_{proc.returncode}: {stderr or stdout}",
                    "usage": None,
                    "steps_completed": 0,
                }

            parsed = _extract_last_json_from_stdout(stdout)
            if parsed is not None:
                return parsed
            else:
                return {
                    "status": "infra_error",
                    "patch": "",
                    "error": f"runner_json_decode_error: stdout={stdout[:500]} stderr={stderr[:500]}",
                    "usage": None,
                    "steps_completed": 0,
                }
        finally:
            problem_file.unlink(missing_ok=True)


def prediction_as_dict(prediction: Prediction) -> dict[str, Any]:
    return asdict(prediction)


def summary_as_dict(summary: PredictionLog) -> dict[str, Any]:
    return asdict(summary)
