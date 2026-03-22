$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

if (-not $env:RUN_ID -or [string]::IsNullOrWhiteSpace($env:RUN_ID)) {
    $latestRun = Get-ChildItem -Path (Join-Path $RepoRoot "runs") -Directory -Filter "run_*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latestRun) {
        throw "No run directory found under runs/. Set RUN_ID or run predictions first."
    }
    $RunId = $latestRun.Name
} else {
    $RunId = $env:RUN_ID
}

$PredictionsPath = Join-Path $RepoRoot "runs\$RunId\predictions\gently_predictions.json"
if (-not (Test-Path $PredictionsPath)) {
    throw "Predictions file not found: $PredictionsPath"
}

$MaxWorkers = if ($env:MAX_WORKERS) { $env:MAX_WORKERS } else { "4" }
$Timeout = if ($env:TIMEOUT) { $env:TIMEOUT } else { "1800" }

Write-Host "Starting SWE-Bench evaluation"
Write-Host "Run ID: $RunId"
Write-Host "Predictions: $PredictionsPath"
Write-Host "Workers: $MaxWorkers"
Write-Host "Timeout: $Timeout"

python -m swebench.harness.run_evaluation `
  --dataset_name scale/SWE-bench_Pro `
  --predictions_path $PredictionsPath `
  --max_workers $MaxWorkers `
  --timeout $Timeout `
  --run_id $RunId
