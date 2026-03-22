# RCA: LevelDB Initialization and Lock Behavior

Date: 2026-03-22  
Workspace: `C:\Users\Bekim Lika\Desktop\Agent`

## Checklist

- `code --version`
  - `1.112.0`
  - `07ff9d6178ede9a1bd12ad3399074d726ebe6e43`
  - `x64`
- Electron version in VS Code Dev Tools (`process.versions.electron`)
  - Not directly accessible from terminal runtime; must be verified in VS Code Dev Tools at runtime.
- Node version (`process.versions.node`)
  - `22.13.1`
- Native module check
  - `level@10.0.0`
  - `xxhash-addon@2.1.0`
  - `hnswlib-node@3.0.0`
- Native rebuild
  - `npm rebuild level xxhash-addon` -> success
- Isolated LevelDB test script
  - Added: `scripts/rca/leveldb-isolation-test.js`
  - Executed successfully
- Windows lock-file behavior test
  - Concurrent open on same DB path was rejected as expected.
  - Manual stale `LOCK` file did not block a fresh open after prior DB close.

## Repro Findings

1. LevelDB roundtrip (`put/get`) works in isolation.
2. Concurrent open is blocked (`Database failed to open`) as expected.
3. Stale lock-file scenario is recoverable after proper close.
4. Earlier failures in this environment were reproducibly tied to permission/sandbox constraints for command execution (`EPERM`) until elevated execution was used.

## Root Cause Assessment

Primary risk factors observed:

- Native module/runtime environment sensitivity (Electron/Node ABI alignment still required).
- Windows lock/permission edge cases during initialization/open.
- Environment permission constraints can masquerade as DB errors.

## Fix Decision

- Keep **LevelDB as single persistent backend**.
- No permanent JSON secondary backend.
- Harden `EmbeddingCache` with:
  - explicit error classification (lock, native-binding, permission, path),
  - bounded retry for lock-busy,
  - stale lock cleanup on retry,
  - explicit `memory-only` degraded mode with actionable recovery guidance.

## Risk

- If runtime Electron ABI mismatch persists in certain user environments, cache can degrade to memory-only until rebuild steps are executed.
- Behavior is now deterministic and observable via explicit degraded-mode logs.
