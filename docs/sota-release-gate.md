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
3. Mode behavior consistency tests.
4. TypeScript compile check.

## Required production settings

- `gently.promptContractV2 = true`
- `gently.modeStateMachineV2 = true`
- `gently.recoveryNarrativeV2 = true`
- `gently.evalGateEnforced = true`
- `gently.resilience.killSwitch = false`

## Rollback

1. Set `gently.resilience.killSwitch = true`.
2. Disable one subsystem at a time (`promptContractV2`, `modeStateMachineV2`, `recoveryNarrativeV2`) if incident scope is known.
3. Re-run gate before re-enabling production flags.
