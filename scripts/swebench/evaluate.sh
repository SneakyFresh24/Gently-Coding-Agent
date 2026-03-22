#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RUN_ID="${RUN_ID:-}"
if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(ls -td runs/run_* 2>/dev/null | head -1 | xargs -n1 basename || true)"
fi

if [[ -z "$RUN_ID" ]]; then
  echo "No run directory found under runs/. Set RUN_ID or run predictions first." >&2
  exit 1
fi

PREDICTIONS_PATH="runs/${RUN_ID}/predictions/gently_predictions.json"
if [[ ! -f "$PREDICTIONS_PATH" ]]; then
  echo "Predictions file not found: $PREDICTIONS_PATH" >&2
  exit 1
fi

MAX_WORKERS="${MAX_WORKERS:-4}"
TIMEOUT="${TIMEOUT:-1800}"

echo "Starting SWE-Bench evaluation"
echo "Run ID: $RUN_ID"
echo "Predictions: $PREDICTIONS_PATH"
echo "Workers: $MAX_WORKERS"
echo "Timeout: $TIMEOUT"

python -m swebench.harness.run_evaluation \
  --dataset_name scale/SWE-bench_Pro \
  --predictions_path "$PREDICTIONS_PATH" \
  --max_workers "$MAX_WORKERS" \
  --timeout "$TIMEOUT" \
  --run_id "$RUN_ID"
