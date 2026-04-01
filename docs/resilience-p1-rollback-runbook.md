# Resilience P1 Rollback Runbook

## Scope

This runbook controls rollback for:

- `gently.resilience.errorContractV1`
- `gently.resilience.retryOrchestratorV1`
- `gently.resilience.telemetryV1`
- `gently.resilience.killSwitch`

## Incident Signals

Trigger rollback if one of these patterns appears after deploy:

- Increased stuck processing/streaming indicators in UI.
- Increased terminal failures with codes:
  - `CTX_RECOVERY_EXHAUSTED`
  - `EMPTY_RESPONSE_RETRY_EXHAUSTED`
  - `SEQUENCE_REPAIR_EXHAUSTED`
  - `RATE_LIMIT_RETRY_EXHAUSTED`
- Unexpected retry storms or duplicate retry notifications.

## Rollback Order

Apply changes in this exact order to minimize impact:

1. Set `gently.resilience.telemetryV1 = false` if telemetry volume itself causes operational noise.
2. Set `gently.resilience.errorContractV1 = false` if UI contract parsing regresses.
3. Set `gently.resilience.retryOrchestratorV1 = false` if retry behavior regresses.
4. Set `gently.resilience.killSwitch = true` for immediate full fallback to legacy behavior.

## Verification After Rollback

Run these checks immediately:

1. Send a normal prompt and confirm request completes and UI spinner clears.
2. Simulate rate limit and confirm legacy retry behavior is active.
3. Simulate empty response and confirm no hard failure loop occurs.
4. Confirm no further `resilienceStatus` events are emitted when contract is disabled.

## Recovery Forward

After stabilizing:

1. Re-enable `telemetryV1` first.
2. Re-enable `errorContractV1`.
3. Re-enable `retryOrchestratorV1`.
4. Turn `killSwitch` back to `false`.
5. Re-run resilience test suites before next rollout.
