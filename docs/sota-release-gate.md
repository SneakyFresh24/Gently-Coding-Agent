# SOTA Resilience Release Gate

## Purpose
This gate blocks production rollout unless Prompt Contract V2, mode contracts, and resilience behavior are green together.

## Command

```bash
npm run resilience:release-gate
```

## Included checks

1. Prompt Contract V2 + family override validation tests.
2. Resilience classifier and retry-flow tests.
3. Runtime engine + replay harness unit tests.
4. R4 hardening gate (`npm run resilience:hardening-gate`) with subsystem-specific chaos/replay soak suites:
   - Chat (1000 flows)
   - Tool (1000 flows)
   - Subagent (1000 flows)
5. Mode behavior consistency tests.
6. TypeScript compile check.

## R4 Hard-Gate SLOs (per subsystem)

- `silentAborts == 0`
- `stuckStates == 0`
- `terminalCoverage >= 0.999`
- `recoveryRate >= 0.95`
- `replayMismatchCount == 0` (100% deterministic replay for identical fault plan + seed)

The hardening gate emits a machine-readable JSON report (`r4-hardening-gate-report.json`) and fails the release gate on any SLO violation.

## Required production settings

- `gently.promptContractV2 = true`
- `gently.modeStateMachineV2 = true`
- `gently.recoveryNarrativeV2 = true`
- `gently.evalGateEnforced = true`
- `gently.resilience.killSwitch = false`

## Rollback

1. Set `gently.resilience.killSwitch = true`.
2. Disable one subsystem at a time (`promptContractV2`, `modeStateMachineV2`, `recoveryNarrativeV2`) if incident scope is known.
3. Re-run `npm run resilience:hardening-gate` and `npm run resilience:release-gate` before re-enabling production flags.
