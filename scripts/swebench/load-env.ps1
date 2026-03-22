$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnvFile = Join-Path $RepoRoot ".env.swebench.local"

if (-not (Test-Path $EnvFile)) {
    throw "Env file not found: $EnvFile"
}

Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.StartsWith("#")) { return }
    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) { return }
    $name = $parts[0].Trim()
    $value = $parts[1]
    Set-Item -Path ("Env:" + $name) -Value $value
}

Write-Host "Loaded SWE-Bench env from $EnvFile"
Write-Host "Model: $env:GENTLY_MODEL"
Write-Host "Smoke size: $env:GENTLY_SMOKE_SIZE"
