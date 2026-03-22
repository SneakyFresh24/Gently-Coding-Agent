# Gently SWE-Bench Pro Integration

This folder contains a Docker-first SWE-Bench Pro pipeline for Gently with:
- per-instance repository checkout (`git clone --filter=blob:none` + `git checkout <base_commit>`)
- a headless **Gently core** runner (`gently_core_runner.ts`)
- SWE-Bench prediction export (`gently_predictions.json`)
- harness evaluation wrappers for PowerShell and Bash

## 1) Prerequisites

- Python 3.8+
- Docker running
- Node.js 20+ (recommended: 22)
- `OPENROUTER_API_KEY` and `GENTLY_MODEL`

Install Python dependencies:

```bash
pip install swebench datasets tqdm docker
```

If needed, also install SWE-Bench Pro repo dependencies in your own checkout:

```bash
git clone https://github.com/scaleapi/SWE-bench_Pro-os.git
cd SWE-bench_Pro-os
pip install -r requirements.txt
```

## 2) Environment

Required:

```bash
export OPENROUTER_API_KEY=...
export GENTLY_MODEL=openai/gpt-4o-mini
```

Windows quick setup (already prepared in this repo):

```powershell
# 1) Edit C:\Users\Bekim Lika\Desktop\Agent\.env.swebench.local and set OPENROUTER_API_KEY
# 2) Load into current shell
.\scripts\swebench\load-env.ps1
```

Defaults (override as needed):

```bash
export GENTLY_MAX_TOKENS=8192
export GENTLY_TEMPERATURE=0.0
export GENTLY_TIMEOUT_SEC=1800
export GENTLY_SMOKE_SIZE=10
export GENTLY_MAX_WORKERS=4
export GENTLY_DATASET_NAME=ScaleAI/SWE-bench_Pro
export GENTLY_DATASET_SPLIT=test
```

Optional:
- `GENTLY_INSTANCE_IDS="id1,id2,id3"` to run selected instances.
- `RUN_ID=run_YYYYmmdd_HHMMSS` for stable run naming.

## 3) Build Runner

From repository root:

```bash
npm run build:scripts
```

If preflight reports native module mismatch (`hnswlib-node`), reinstall node modules in WSL/Linux:

```bash
rm -rf node_modules
npm install
npm run build:scripts
```

Runner output path:

`out/scripts/scripts/swebench/gently_core_runner.js`

## 4) Generate Predictions

Recommended: run predictions in WSL/Linux to avoid Windows path-length clone failures.

```bash
python scripts/swebench/run_predictions.py
```

Outputs:
- `runs/<run_id>/predictions/gently_predictions.json`
- `runs/<run_id>/logs/prediction_logs/<instance_id>.jsonl`
- `runs/<run_id>/summary.json`

## 5) Evaluate Predictions

PowerShell (Windows):

```powershell
./scripts/swebench/evaluate.ps1
```

Bash:

```bash
./scripts/swebench/evaluate.sh
```

Both wrappers default to:
- `--max_workers 4`
- `--timeout 1800`
- latest `runs/run_*` directory if `RUN_ID` is not set

For reliable SWE-Bench runs, use WSL/Linux for both prediction generation and evaluation.

## 6) Logging and Statuses

Per-instance JSONL logs include:
- `timestamp`
- `instance_id`
- `step`
- `status`
- `message`
- `error`

Adapter summary statuses:
- `success`
- `invalid_patch`
- `timeout`
- `infra_error`

## 7) Troubleshooting

- Docker daemon not running: start Docker Desktop.
- `runner not found`: run `npm run build:scripts`.
- `OPENROUTER_API_KEY is required`: set env var in current shell.
- frequent 429/5xx: reduce concurrency and increase retry/backoff envs:
  - `GENTLY_RETRY_MAX`
  - `GENTLY_RETRY_BACKOFF_SEC`
