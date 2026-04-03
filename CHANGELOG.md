# Changelog

All notable changes to the "Gently" extension will be documented in this file.

## [0.10.0] - 2026-04-02

### Added
- **Prompt Contract V2 (Claude-style)**: Introduced modular prompt sections (`identity`, `objective`, `mode_contract`, `tool_policy`, `recovery_policy`, `output_contract`, `runtime_hints`) with strict required-component validation.
- **Mode Contract V2 Utilities**: Added shared mode-contract policy helper (`PLAN_STRICT` / `ACT_STRICT`) for deterministic tool allow/deny decisions.
- **R4 Chaos/Replay Harness**:
  - Added shared deterministic soak utilities (`R4SoakHarness`) for seeded fault plans, replay snapshot normalization, mismatch detection, and standardized suite report output.
  - Added unit coverage for harness determinism and replay comparison.
- **R5 In-Chat Question Card V1**:
  - Added structured ask-question webview contract (`questionRequest`, `questionResponse`, `questionResolved`) with deterministic timeout-default resolution.
  - Added inline chat question-card rendering with single/multiple selection, submit/cancel actions, and resolved-state replay in chat history.
  - Added ToolManager-owned ask-question runtime orchestration with stop/abort-safe pending question handling and kill-switch fallback to legacy path.
- **R3 Subagent Orchestration Core**:
  - Added `SubagentRunStateMachine` with deterministic phases (`IDLE -> PREFLIGHT -> MODE_SWITCH -> WORKER_RUN -> MERGE_SUMMARY -> TERMINAL`) and strict transition/terminal guarantees.
  - Added `SubagentRetryPolicyEngine` for recoverable handover failures (`mode_switch_recoverable`, `worker_start_recoverable`) with fixed retry budget/backoff.
  - Added `SubagentOrchestrator` as single-owner runtime for `handover_to_coder` with single-active-run invariant and auto-start of coder continuation after successful handover.
- **R3 Structured UI Contract**:
  - Added outbound webview event `subagentStatus` with stable code-based statuses for subagent lifecycle, retries, hook failures, stop, and summary completion.
  - Added UI/webview message wiring for `subagentStatus` and compact system rendering in chat.
- **R3 Production Flags**:
  - `gently.resilience.subagentOrchestratorV1` (default `true`)
  - `gently.resilience.subagentErrorContractV1` (default `true`)
  - `gently.resilience.subagentTelemetryV1` (default `true`)
- **R2 Tool + Hook Runtime Core**:
  - Added `ToolRunStateMachine` with deterministic phases (`INIT -> PRE_HOOK -> VALIDATE -> CIRCUIT -> APPROVAL -> EXECUTE -> POST_HOOK -> TERMINAL`) and hard transition/terminal guards.
  - Added `ToolRetryPolicyEngine` with fixed recoverable retry budget/backoff (`2` retries, `500ms/1000ms`).
  - Added hook correlation context propagation (`flowId`, `correlationId`, `toolCallId`, `attempt`, `phase`, `mode`) and stable hook failure codes.
- **R2 Production Flags**:
  - `gently.resilience.toolOrchestratorV2` (default `true`)
  - `gently.resilience.hookContractV2` (default `true`)
  - `gently.resilience.toolTelemetryV2` (default `true`)
- **R2 Test Coverage**:
  - Added hook policy contract tests (`src/hooks/HookManager.test.ts`).
  - Added tool runtime engine tests (`ToolRunStateMachine`, `ToolRetryPolicyEngine`).
  - Added tool orchestration tests (`ToolManager.orchestration.test.ts`) and dispatcher metadata delegation assertions.
  - Added `ToolManager.soak.test.ts` with 1000 mixed fault-injected tool flows as R2 hard gate.
- **R3 Test Coverage**:
  - Added `SubagentRunStateMachine.test.ts`, `SubagentRetryPolicyEngine.test.ts`, and `SubagentOrchestrator.test.ts`.
  - Added `SubagentOrchestrator.soak.test.ts` with 1000 fault-injected subagent flows as R3 hard gate.
- **R4 Soak Coverage Upgrade**:
  - Upgraded chat/tool/subagent 1000-flow soak suites to deterministic seeded chaos replay with strict R4 SLO assertions.
  - Added explicit fault catalog coverage for `429`, `400/context-overflow`, `stream-cut`, `tool-invalid`, and mixed fault chains across the resilience corpus.
- **Webview Interaction Contract**:
  - ChatViewProvider now accepts `questionResponse` messages and routes them deterministically to ToolManager pending question runs.
- **R5.1 Mode-Desync Regression Coverage**:
  - Added `ChatViewProvider.modeSync.test.ts` for blocked `PLAN -> ACT` transition fallback behavior.
  - Added dispatcher regression tests for mode desync self-heal + structured `MODE_TOOL_BLOCKED` emission.
  - Added mode-alias validation tests (`plan/act`) in `ToolCallManager.test.ts`.
- **R1 Runtime Engines**:
  - `TurnEngine` state machine (`INIT -> PREFLIGHT -> STREAMING -> TOOL_EXEC -> RECOVERY -> TERMINAL`) with strict transition/terminal invariants.
  - `RetryPolicyEngine` with deterministic budgets/backoffs (`context=4`, `sequence=3`, `empty=2`, `rate_limit=2`).
  - `StreamContractEngine` for explicit stream-stop and strict empty-response contract checks.
  - `LifecycleGuard` for idempotent lifecycle messaging (`processing*`, `generating*`).
- **R1 Soak Coverage**:
  - Added `ChatFlowManager.soak.test.ts` with 1000 fault-injected flows and hard assertions for silent-abort/stability/recovery criteria.
- **New Production Settings**:
  - `gently.promptContractV2` (default `true`)
  - `gently.modeStateMachineV2` (default `true`)
  - `gently.recoveryNarrativeV2` (default `true`)
  - `gently.evalGateEnforced` (default `true`)
  - `gently.modeRouting.planModelDefault` / `gently.modeRouting.codeModelDefault` (optional model routing defaults per mode)
- **Release-Gate Script + Doc**:
  - `npm run resilience:release-gate`
  - `docs/sota-release-gate.md`

### Changed
- **R5.1 Mode State Sync Hotfix**:
  - Runtime mode boot now prioritizes stored `selectedMode` over `agentMode` fallback to prevent UI/runtime desync.
  - Blocked `PLAN -> ACT` transitions now force-safe sync back to Architect/Plan mode and emit `modeChanged` + structured `resilienceStatus`.
- **Mode Contract Aliases (non-breaking)**:
  - Added internal alias support `plan -> architect` and `act -> code` for deterministic contract resolution without breaking existing mode IDs.
- **Mode Validation Terminal Guard**:
  - Mode validation failures now emit structured `resilienceStatus` (`MODE_STATE_DESYNC_DETECTED`, `MODE_TRANSITION_BLOCKED`, `MODE_TOOL_BLOCKED`) plus legacy `error` fallback and deterministic lifecycle end signals.
- **Family Overrides → Structured Deltas**: Model-family prompt overrides now target validated prompt components (`tool_policy`, `recovery_policy`, `output_contract`, etc.) instead of free-form append-only rule blocks.
- **Mode State Machine Guardrails**:
  - PLAN->ACT transition now requires an existing persisted plan when `modeStateMachineV2` is enabled.
  - Optional mode-based model default routing is applied on successful mode switch.
- **Global Kill-Switch Consistency**:
  - `gently.resilience.killSwitch` now consistently disables the new Prompt/Mode V2 guard paths as well (Prompt Contract V2 strict path, mode transition guard, and tool mode-contract enforcement), forcing deterministic legacy fallback behavior.
- **Runtime Recovery Coupling V2**: Retry attempts now inject structured recovery narratives into request context (`RECOVERY_NARRATIVE_V2`) for deterministic retry behavior.
- **Tool Execution Contract Enforcement**: Tool-call validation now enforces both plan and act restrictions with stable `MODE_TOOL_BLOCKED` errors.
- **Structured Error Contract V2**: `resilienceStatus` payload now includes `phase`, `decision`, `reason`, and `correlationId`; telemetry/log events now include `mode` and correlation continuity.
- **Tool/Hook Structured Contract Expansion**: `resilienceStatus` now includes stable tool/hook resilience codes (`TOOL_RETRY_SCHEDULED`, `TOOL_RETRY_EXHAUSTED`, `HOOK_PRE_BLOCKED`, `HOOK_PRE_FAILED`, `HOOK_POST_FAILED`, `HOOK_NOTIFICATION_FAILED`, `TOOL_APPROVAL_TIMEOUT`) and code-driven UI actions.
- **Single-Owner Tool Execution Path (R2)**:
  - `ExecutionDispatchers` now forwards flow/correlation metadata and delegates tool execution to `ToolManager` as the single orchestration owner.
  - Centralized tool retry/terminalization into ToolManager V2 path and removed competing retry ownership in dispatcher path.
- **Single-Owner Subagent Execution Path (R3)**:
  - `ExecutionDispatchers` now routes `handover_to_coder` through `SubagentOrchestrator` instead of ad-hoc follow-up handling.
  - Architect->Coder handover now enforces preflight/mode-contract checks and auto-starts coder continuation on successful mode switch.
- **Hook Context Enrichment (R3)**:
  - Added `subagentId` propagation in hook context for deterministic subagent correlation across hook execution and telemetry.
- **Hook Contract Semantics (R2)**:
  - `PreToolUse` now enforces fail-closed under `hookContractV2`.
  - `PostToolUse`/`Notification` remain fail-open with explicit structured failure reporting.
- **Telemetry Semantics**: `RESILIENCE_ATTEMPT_START` now emits code `REQUEST_ATTEMPT` (instead of `REQUEST_STOPPED`) for clean observability and alerting semantics.
- **UI Resilience Rendering**: Webview resilience messages now render code-based fallback + action hint + phase/decision/reason metadata consistently.
- **Stream Termination Contract**:
  - OpenRouter streaming now emits explicit `message_stop` terminal chunks when provider finish markers are observed.
  - `StreamingService` propagates `streamTerminated` to the orchestration layer.
  - `ChatFlowManager` fails fast on missing terminal stop with stable code `STREAM_CONTRACT_MISSING_STOP`.
- **Release Gate Hardening**:
  - `scripts/resilience-release-gate.js` now includes runtime engine suites and the required R1 soak-gate run.
  - Added R2 tool/hook orchestration suites as mandatory release-gate checks.
  - Added R3 subagent orchestration suites and R3 1000-flow soak gate as mandatory release-gate checks.
  - Added dedicated R4 hardening gate (`resilience:hardening-gate`) as merge blocker with subsystem-specific SLO validation and machine-readable JSON reporting.
  - Added ask-question runtime + contract tests (`ToolManager.askQuestion.test.ts`) and message-validator contract coverage for `questionResponse`.
  - Added `npm run resilience:soak`.

## [0.9.82] - 2026-04-01

### Added
- **Resilience Status Contract (V1)**: Added structured outbound webview message `resilienceStatus` with stable fields (`code`, `category`, `severity`, `retryable`, `attempt`, `maxAttempts`, `nextDelayMs`, `model`, `flowId`, `userMessage`, `action`).
- **P1 Resilience Flags**:
  - `gently.resilience.errorContractV1` (default `true`)
  - `gently.resilience.retryOrchestratorV1` (default `true`)
  - `gently.resilience.telemetryV1` (default `true`)
- **Rollback Runbook**: Added `docs/resilience-p1-rollback-runbook.md` with phased rollback/restore guidance for incident response.
- **Chat Flow Regression Coverage**: Added focused tests for `ChatFlowManager` resilience paths (preflight context guard, empty-response retries/exhaustion, stop handling, rate-limit retries, guardrail block, kill-switch behavior).

### Changed
- **Retry Orchestration (P1)**: Consolidated retry behavior in `ChatFlowManager` into a deterministic flow with strict priority handling:
  - `guardrail -> stop -> context -> sequence -> empty -> rate_limit -> terminal`.
- **Context Budget Guardrails (P0/P1)**:
  - `computeMaxOutputTokens` now clamps to `>= 0` (no artificial `256` floor when budget is exhausted).
  - Added hard preflight context safety checks with deterministic recovery chain:
    - aggressive recompress
    - tool-output prune
    - output-token reduction
  - Recovery attempts are bounded and only continue when state actually changes.
- **Error Classification Separation**:
  - Separated context-length detection from tool-sequence detection.
  - Context overflow patterns are no longer treated as sequence errors by default (legacy opt-in only).
- **UI Resilience Messaging**:
  - Webview now consumes `resilienceStatus` for consistent retry/system messaging and activity updates.
  - Legacy retry/error messaging remains as compatibility fallback.
- **Telemetry/Event Consistency**:
  - Added structured resilience telemetry events:
    - `RESILIENCE_ATTEMPT_START`
    - `RESILIENCE_RETRY_SCHEDULED`
    - `RESILIENCE_RECOVERY_APPLIED`
    - `RESILIENCE_TERMINAL_FAILURE`
    - `RESILIENCE_STOPPED_BY_USER`

### Fixed
- **Silent Empty Responses**: Stream completions with no assistant text and no tool calls now fail fast via explicit empty-response detection and bounded retries, then surface a clear terminal error.
- **Wrong Retry Loop Routing**: Prevented context-overflow failures from entering sequence-repair retry loops.
- **Stop/Retry Flow Safety**: Added stricter stop checks to prevent unintended retries after user stop.
- **Repository Scope Hygiene**: Excluded `CLINE` and `CLAUDE CODE` paths (including common casing/name variants) from TypeScript configs and git tracking to avoid accidental build/test scope pollution.

## [0.9.7] - 2026-03-28

### Added
- **Mode Tool Consistency Test**: Added `src/modes/tests/ModeToolConsistency.test.ts` to enforce that all mode `availableTools` are registered in tool definitions.
- **Chat Toolbar Mode Toggle**: Added a dedicated mode toggle UI in the chat footer (`ModeToggle.svelte`) next to Auto-Approve and Model selection.
- **Runtime Config Sync Hook**: Added `onDidChangeConfiguration` handling in `extension.ts` for live updates of:
  - `gently.agentMode`
  - `gently.selectedModel`
  - `gently.validation.enabled`
  - `gently.validation.strictMode`

### Changed
- **Canonical Mode Switching Path**:
  - Standardized on `setMode(modeId)` as canonical inbound mode contract.
  - Kept `toggleAgentMode` as compatibility alias mapped to `architect <-> code`.
- **Command Wiring Cleanup**:
  - Registered and wired `gently.toggleAgentMode` end-to-end.
  - Removed legacy/unused internal command handlers not wired into active flows.
- **Settings Now Runtime-Effective**:
  - `gently.temperature` is now applied as a real override in `ModeService.getTemperature()` (with clamp/fallback).
  - `gently.selectedModel` and `gently.agentMode` are synchronized with runtime mode/model state.
- **Validation Wiring**:
  - Validation initialization is now executed during activation.
  - `gently.validation.enabled` and `gently.validation.strictMode` now flow into the real validation pipeline via `AgentManager.applyValidationConfiguration(...)`.
- **Mode Tool Lists Synchronized**:
  - Replaced legacy `get_memories` references with `recall_memories`.
  - Removed non-existent tool names from mode tool lists (`run_linter`, `run_type_check`, `execute_test`).
- **Webview Contract Cleanup (BYOK)**:
  - Removed unused auth message types (`login`, `signup`, `logout` and related outbound auth events).
  - Removed unimplemented/stub inbound message paths (`getIndexingStats`, `refreshIndexing`, `addSourceFolder`).
  - Removed inbound `modeChanged` handling; mode updates are now driven by `setMode` (plus alias mapping).

### Fixed
- **Mode UX Drift**: Fixed mode-toggle drift between backend/runtime and webview by sending current mode state during webview initialization.
- **Validation Settings No-Op**: Fixed previously inert validation settings by wiring them to active validation/file operation behavior.

## [0.9.4] - 2026-03-27

### Added
- **Compression Sync Event**: Added new outbound webview event `messagesCompressed` with payload `{ remainingMessages, droppedCount, summaryInserted, source }` to keep UI and backend history in sync after context compaction.
- **Tool-Execution Compression Guard**: Added runtime state tracking (`isToolExecutionActive`) in chat context so compression can be postponed while tools are running when safe.
- **Mutex Timeout Coverage**: Added dedicated `Mutex` tests (`src/core/state/Mutex.test.ts`) for serialization guarantees and timeout behavior that verifies timed-out callbacks do not execute later.

### Changed
- **Session Transition Safety (Race-Safe)**:
  - Added per-session mutex locking with lock-timeout fast-fail (3s) and user-facing busy info messages in `SessionHandler`.
  - Standardized clear-before-load flow for session switching/new/delete/clear-all paths.
  - Added stale-switch invalidation token to prevent outdated in-flight session loads from rendering after newer transitions.
- **Durable Compression Commit (Storage-First Atomicity)**:
  - Introduced atomic compression commit helper in `ChatFlowManager` that persists compressed history first, then updates runtime conversation state, then emits UI sync event.
  - Compression commit now hard-fails safely on persistence errors (no UI compression event is emitted on failed storage writes).
- **Frontend Message Reconciliation**:
  - Added `messagesCompressed` handling in webview messaging/store pipeline.
  - Compression updates now reconcile messages by stable `id` instead of blind full replace to reduce flicker and stale-stream artifacts.
- **Virtualized Message List Reset**:
  - Added reset epoch plumbing in chat store/messages area to invalidate virtualizer measurements and re-measure/scroll consistently on session hydrate and compression updates.

### Fixed
- **Webview Session UI Glitches**: Resolved stale/overlapping message rendering during rapid session transitions caused by non-serialized session operations and out-of-order loads.
- **Context Compression Desync**: Fixed backend/frontend desynchronization where UI could display messages already removed from effective model context.
- **Lock Timeout Correctness**: Prevented timeout race where queued operations could still execute after an acquisition timeout by implementing proper timed waiter removal in `Mutex`.

## [0.9.3] - 2026-03-25

### Added
- **Model Policy Layer (v1)**: Added centralized model-policy utilities (`src/utils/modelPolicy.ts`) covering model-family detection, reasoning policies, provider cache-hints, Gemini schema sanitization, Claude ID normalization, and WebP fallback hook-points.
- **Model Policy Settings**:
  - `gently.modelPolicies.skipReasoningForIncompatibleModels`
  - `gently.modelPolicies.providerCaching.enabled`
  - `gently.modelPolicies.geminiSchemaSanitization.enabled`
  - `gently.modelPolicies.reasoningEffort`
  - `gently.modelPolicies.webpFallback.enabled`

### Changed
- **Streaming Reasoning Handling**: Reasoning deltas are now skipped by policy for known noisy/incompatible models (default on, configurable).
- **Request Normalization**: Request pipeline now uses model-policy decisions for sequence-fix application, provider cache hints, and Gemini tool-schema sanitization.
- **Sampling/Reasoning Wiring**: Chat flow now forwards policy-driven `top_p`, `top_k`, and reasoning configuration through the streaming request path.

## [0.9.2] - 2026-03-25

### Added
- **Hybrid Pruning Configuration**: Added new settings for fast local pruning behavior:
  - `gently.pruning.strategy` (`hybrid|legacy`, default `hybrid`)
  - `gently.pruning.maxHistoryLength` (default `50`)
  - `gently.pruning.maxToolOutputChars` (default `500`)
  - `gently.pruning.protectedTurns` (default `2`)
- **Hybrid Pruning Test Coverage**: Added focused unit tests for first-pair retention, protected-turn behavior, priority truncation markers, defensive `tool_calls[].result` handling, and legacy fallback path.

### Changed
- **Conversation Pruning Pipeline (v2)**: Replaced default summarization-first pruning with a two-phase hybrid pipeline:
  - Phase 1: Tool-output pruning with priority extraction (`head + error lines + tail`)
  - Phase 2: Rule-based history truncation with first-pair retention and dedupe
- **Default History Threshold**: Increased default `MAX_HISTORY_LENGTH` from `20` to `50` for hybrid mode.
- **Standardized Truncation Markers**: Introduced deterministic marker format for testability and diagnostics:
  - `[TRUNCATED <from>→tool_output]`
  - `[TRUNCATED <from>→history_limit]`
- **Pruning Observability**: Added structured pruning logs including before/after message count, estimated token savings, and per-phase reduction stats.
- **UI Activity Cleanup**: Removed explicit `Pruning conversation...` activity update (pruning is now fast enough to avoid visible UX noise).

### Fixed
- **First-Pair Preservation in Architect Flows**: First response retention now works even when the initial assistant message includes `tool_calls`.
- **Context Stability During Repeated Pruning**: Prevented repeated history-marker accumulation by filtering prior history-limit markers before inserting a fresh marker.
- **Forward Compatibility for Tool Result Shapes**: Added defensive pruning support for provider/plugin variants that may include tool output in `assistant.tool_calls[*].result`.

## [0.9.0] - 2026-03-24

### Added
- **Global Model Resolver in Session Flow**: Added a runtime model resolver callback path from `ChatViewProvider` into `SessionHandler` to preserve selected model continuity across session state resets.
- **Tool Message Formatters for Architect Tools**: Added dedicated tool-result formatting for `analyze_project_structure`, `create_plan`, and `ask_question` in the webview tool message component.

### Changed
- **New Session Model Inheritance**: New chat sessions now inherit the currently selected model into session metadata when available.
- **Session Runtime Model Resolution**: Session runtime state now resolves model as `session model -> current/global selected model` instead of forcing `null` on reset flows.

### Fixed
- **`write_file` Result Path Field**: `write_file` success responses now include a structured `path` field (in addition to the message) so UI/tool consumers can reliably resolve the written filename.
- **Raw JSON Tool Output in UI**: Prevented fallback JSON rendering for key architect tools by introducing compact, explicit summaries:
  - `📊 Analyzed {projectName} ({type})`
  - `📋 Plan created (X steps)`
  - `❓ User selected: ...`
- **Model Selection Loss on Session Reset**: Fixed model selection disappearing during new-session/clear-session flows by replacing `applyRuntimeSessionState([], null)` resets with resolved model fallback behavior.

## [0.8.93] - 2026-03-23

### Added
- **Standardized Tool Error Codes**: Introduced canonical tool-flow error codes (`JSON_PARSE_ERROR`, `TOOL_ARGS_TRUNCATED`, `TOOL_ARGS_TOO_LARGE`, `TOOL_EXECUTION_ERROR`, `TOOL_NOT_FOUND`) and aligned retry/error handling around them.
- **Streaming Incomplete Tool-Call Diagnostics**: Added structured tracking for incomplete streamed tool calls (preview, truncation reason, recovered fields, char count) to improve truncation recovery visibility.
- **Retry Prompt Templates for LLM Self-Recovery**: Added dedicated retry templates for truncated and oversized tool arguments with explicit chunking guidance.
- **Regex Search Tooling (Safety-First MVP)**: Added `regex_search` capability with index/fallback metadata, engine provenance, and runtime safety/budget transparency.
- **Mode-Switch Post-Action Flow**: Added centralized post-tool action handling for workflow tool results (`requestedMode`, `shouldAutoContinue`, `continuationPrompt`) with local follow-up skip logic.
- **Mode-Switch Loop Protection**: Added recent mode-switch tracking and duplicate-switch suppression to prevent repeated workflow loops.
- **Tool Message UX Formatter**: Added compact, tool-aware rendering in chat UI (instead of raw JSON blobs), with graceful error/preview fallback for non-JSON content.

### Changed
- **Tool-Args Pipeline Order**: Enforced robust tool-arg pipeline order: JSON repair -> model-content fixes -> validation -> execution.
- **Model Content Fixes Coverage**: Expanded model-specific content normalization (DeepSeek entity decode, Llama/Gemini escape normalization, fence trimming) on content-like tool arguments.
- **Tool Result Truncation Policy**: Added deterministic truncation for large tool outputs with actionable suffix guidance for downstream model behavior.
- **Context Overflow Recovery**: Improved overflow handling by pruning older tool outputs while protecting recent turns, reducing hard-fail risk in long sessions.
- **MiniMax Request Tuning**: Added model-specific generation tuning (`temperature`/`top_k`) for MiniMax variants.
- **Architect Handover Architecture**: Shifted handover flow toward `ask_question`-driven transitions and deferred mode-switch orchestration via dispatcher post-actions.
- **Pruning UX Signal**: `Pruning conversation...` activity is now emitted only when pruning is actually needed.
- **Activity Indicator Placement**: Removed top-header duplicate activity rendering; activity feedback now remains in the input section path.
- **Prompt Guidance for File Writes**: Strengthened write/edit guidance to prefer path-first argument order and sub-50KB chunking.

### Fixed
- **Truncated JSON Path Recovery**: Improved partial JSON recovery to prioritize path-like fields (`path`, `file_path`, `filePath`, `dir_path`, `directory`) before generic extraction, reducing `path: "unknown"` cases.
- **Oversized Tool Arguments**: Added hard-fail guards for oversized `write_file.content` and `safe_edit_file.new_content` payloads (>50k chars), with deterministic error propagation.
- **Session Persistence for Tool Labels**: Preserved `toolName` through history save/load paths so formatted tool messages remain stable after reload.
- **Provider Error Detection Coverage**: Expanded detection patterns for tool-sequence and context-length failures across more provider-specific wording variants.

## [0.8.9] - 2026-03-23

### Added
- **Sequence Error Recovery (Minimax/Provider)**: Added targeted auto-retry flow for tool-call sequence errors (`tool call result does not follow tool call`) with exponential backoff (2s/4s/8s).
- **Repair Diagnostics for Conversation History**: Introduced structured repair result tracking (`repaired`, `fixes`, `issuesBefore`, `issuesAfter`, `repairHash`) for tool-call sequence healing.
- **Retry Visibility in UI**: Added `retryStatus` webview event to show sequence-repair retries with attempt/delay/fixes.
- **Activity & Tool Progress UI (v1.1)**:
  - New `ActivityIndicator.svelte` with anti-flicker label smoothing and accessible live-region semantics.
  - New `TypewriterText.svelte` for lightweight activity typewriter animation.
  - New `ToolExecutionBadge.svelte` for active tool visibility and compact low-stakes grouping.

### Changed
- **Follow-up Validation Wiring**: Replaced dummy follow-up validation callbacks with real `ToolCallManager` sequence validation and repair.
- **Tool-Call Sequence Preflight**: Chat flow now performs preflight sequence validation/repair before request retries and logs model-aware diagnostics for known problematic models.
- **Token Tracking Semantics**:
  - Split UI tracking between `currentContextTokens` and cumulative session totals.
  - `tokenTrackerUpdate` now includes context-oriented fields (`currentContextTokens`, `modelContextLength`, `session*` totals, compression metadata).
- **Proactive Context Compression**:
  - Added thresholded behavior (proactive near high utilization, aggressive near critical utilization).
  - Added compression warnings and throttled compression observability logs.

### Fixed
- **Misleading Token Utilization**: Fixed UI over-100% confusion caused by comparing session-cumulative totals against single-request context limits.
- **Pinned Message Safety During Compression**: Compression now preserves pinned messages and avoids dropping protected context.
- **Compression Stability**: Added optional summary injection (`_compressed`) when larger portions of history are trimmed, improving context continuity.
- **Stale Tool Indicators**: Added timeout-based cleanup (30s) for orphaned tool badges when completion events are missing.
- **Activity Indicator Flicker**: Added minimum label visibility smoothing (300ms) to prevent rapid UI label flashing.

## [0.8.0] - 2026-03-21

### Added
- **Structured OpenRouter HTTP Errors**: Introduced typed `OpenRouterHttpError` handling with status/code/model/maxTokens and provider metadata support.
- **Rate-Limit Retry Visibility**: Added `retryingRateLimit` webview event to surface 429 backoff retries in the chat UI.
- **Context Retry Visibility**: Added explicit `retryingWithReducedTokens` event for one-time output-token reduction retries.

### Changed
- **No Implicit Model Defaults**: Removed hardcoded runtime model fallbacks; model selection is now explicit and session-driven.
- **Session Model Source of Truth**: Active session metadata now drives runtime model state on new/switch/delete flows.
- **OpenRouter Error Resilience**:
  - 404 guardrail/privacy mismatch now triggers actionable user guidance (including OpenRouter privacy settings hint).
  - 400 context-length overflow now performs a single controlled retry with reduced `max_tokens`.
  - 429 provider/rate-limit errors now use short exponential backoff retries (with Retry-After support when available).
- **Token Budgeting**: Output token budget now accounts for estimated input size, safety factor, reserve, model limits, and user max-token configuration.

### Fixed
- **Model Desync Issues**: Resolved stale/wrong model usage across session switching and message send path.
- **Invalid Model IDs**: Prevented legacy/non-OpenRouter IDs (`glm-4.6`, `deepseek-chat`, `unknown`) from being used in runtime requests.
- **Streaming State Consistency**: Improved processing/generating lifecycle consistency during retry/error scenarios.

## [0.7.3] - 2026-03-19

### Added
- **Backend History Manager**: Introduced a new `HistoryManager` service in `src/services/` to replace legacy session logic.
- **Token Tracking System**: Added `TokenTracker` utility to persist and monitor token usage across all LLM interactions.
- **Shield Guardian View**: Implemented a dedicated security and performance monitoring dashboard in the webview.
- **Enhanced Navigation**: Added a multi-view router with Header, Model Selector, and real-time Token Usage display.
- **Chat History Dashboard**: New interface for browsing, searching, and restoring past conversation sessions.
- **Refined Settings**: Comprehensive settings panel for API key management and application preferences.

### Changed
- **Backend Refactoring**: Centralized approval and terminal types in `src/types/approval.ts` for better maintainability.
- **Service Integration**: Updated `OpenRouterService` to automatically report token usage to the new tracking system.

### Fixed
- **Compilation Stability**: Resolved multi-file import errors and dependency injection issues in `ServiceProvider.ts`.
- **Legacy Cleanup**: Removed redundant session folders and outdated performance test suites.
- **A11y & Polish**: Fixed accessibility warnings and optimized CSS for a native VS Code aesthetic.

## [0.7.2] - 2026-03-19

### Added
- **Major Webview Rebuild**: Replaced the legacy React/Tailwind UI with a modern Svelte 5 + Vanilla CSS architecture.
- **Svelte 5 Runes**: Leveraged `$state`, `$derived`, and `$effect` for explicit reactivity and better performance.
- **Cline-Inspired UI**: Redesigned the interface to follow a more streamlined, professional utility-first layout.
- **Vanilla CSS Tokens**: Fully integrated VS Code theme tokens (`--vscode-*`) for perfect native styling and accessibility.
- **Refactored Store System**: Centralized state management in dedicated Svelte stores (`extensionStore`, `chatStore`, `settingsStore`).
- **Auto-Initialization**: Implemented automatic `ready` signaling from the webview to the backend.
- **Race Condition Prevention**: Added versioning to `AutoApprovalSettings` to handle concurrently updated settings.
- **Enhanced Input Handling**: Multi-line support with `Enter` to send and `Shift+Enter` for newlines.
- **Auto-Approve System UI**: Dedicated bar and settings modal for granular tool execution control.

### Changed
- **Styling Architecture**: Completely removed Tailwind CSS in favor of a lean, maintainable vanilla CSS system.
- **Messaging Bridge**: Type-safe messaging bridge with automated response handling.

### Fixed
- **UI Responsiveness**: Optimized virtualized message list and input responsiveness using Svelte 5's fine-grained reactivity.

### Removed
- **Legacy Frontend**: Deleted old React source files, CSS frameworks, and redundant build artifacts.

## [0.7.1] - 2026-03-17

### Added
- **Dynamic Token Management**: Implemented automatic fetching of `max_output` limits from OpenRouter to maximize generation capacity and prevent truncation.
- **Robust JSON Repair**: Added a state-aware JSON sanitizer that automatically repairs truncated objects, arrays, and strings from mid-stream cuts.

### Changed
- **Text-Based Planning**: Replaced the JSON-based `create_plan` and `execute_plan` tools with a streamlined Markdown-based planning flow in the chat.
- **Tool Context Optimization**: Drastically shortened tool descriptions in `definitions.ts` to reduce token overhead and improve prompt adherence.
- **Handover Workflow**: Unified the Architect-to-Coder transition to use plan summaries and preserve chat history for implementation.

### Fixed
- **Command Approval Flow**: Fixed a critical response type mismatch between frontend and backend.
- **Backend Validation**: Synchronized the `MessageValidator` schema with the modern approval response enum.
- **Streaming Tool-Call Stability**: Resolved the "Empty Tool Name" error by ensuring tool calls are only emitted once both ID and Name are fully received from the stream.

### Added
- **Command Approval Options**: Added a new "Accept Always" button to the approval dialog for faster workflow.
- **Dynamic Token Management**: Implemented automatic fetching of `max_output` limits from OpenRouter to maximize generation capacity and prevent truncation.

## [0.7.0] - 2026-03-16
### Fixed
- **Iterative Planning**: Disabled unintended automatic search loops for long goals.
- **Plan Step Extraction**: Fixed issue where LLM-provided steps were ignored in `create_plan` tool calls.
- **Tool Call Validation**: Improved resilience to malformed tool call structures and added repair logging.
- **UI Visibility**: Added unique IDs to system messages to ensure they are correctly processed by the webview store.
- **Granular Reporting**: Added detailed retry notifications and timeout warnings for terminal approvals.
- **Approval Flow**: Implemented 30-second warning before 5-minute approval timeout.
- **Race Condition**: Awaited `AgentManager` initialization before starting `ChatViewProvider` to prevent service resolution errors.
- **Event Propagation**: Fixed uninitialized `eventCallback` in `CommandTools` by implementing proper propagation from `ToolManager`.
- **Approval Logging**: Added detailed logs and explicit error throwing in `ToolManager` to prevent silent approval failures.
- **Tool Normalization**: Added support for string-based function calls and detailed JSON logging for malformed tools.
- **Event Queuing**: Added buffering for messages sent before webview is ready, preventing lost approval prompts.
- **Handover Transition**: Unified handover logic in backend with automatic plan execution and smooth mode switching.
- **Initialization Stability**: Fixed race condition in `ChatViewProvider` startup sequence.
- **Tool Manager Optimization**: Removed redundant tool re-creations and added enhanced structured logging for approvals.


## [0.6.3] - 2026-03-16

### Added
- **Web Search Integration**: Introduced the `web_search` tool (with `search_web` alias) for enhanced research capabilities.
- **Parallel Tool Calling**: Implemented a centralized execution core in `ToolManager` with file-path dependency detection. Independent tools now run simultaneously while maintainng data integrity for file modifications.
- **Session Resilience**: Added per-session `Mutex` protection and auto-recovery from backup files (`.bak`) to prevent session corruption.
- **Debounced Persistence**: Added a 300ms debounce for session saves with a crash-safe `async flush` mechanism on extension shutdown.
- **Enhanced UI Feedback**: Implemented "eager" tool call emission and partial name updates for real-time progress visualization.

### Fixed
- **Conversation Persistence**: Fixed the "Missing tool result" bug by ensuring tool execution results are saved to both runtime and disk history.
- **UI Indicator Stability**: Resolved sticky status labels (e.g., "Preparing prompt...") that remained visible after tasks finished or errored.
- **Planning Reliability**: Fixed a critical `TypeError` occurred during iterative planning with missing step definitions.

### Changed
- **Tool Registration**: Refactored `ServiceProvider.ts` and `ToolManager.ts` to support dynamic tool registration and improved dependency injection.

## [0.6.0] - 2026-03-15

### Added
- **Cline-Inspired Task/Plan Architecture**: Implemented a more robust, centralized system for task management.
- **State Protection**: Added a `Mutex` to `TaskState` to prevent race conditions during parallel tool executions.
- **Centralized Task Management**: Introduced `TaskState` and `Task` classes to orchestrate complex execution flows with retry and recovery logic.
- **Universal Progress Tracking**: Added `task_progress` parameter to all tool schemas for granular real-time feedback.

### Changed
- **Core Refactor**: Replaced legacy planning components with a modern service layer (`PlanningManager`, `MessageStateHandler`).
- **Improved Event Flow**: Centralized all outgoing webview messages to ensure state consistency.

### Fixed
- **DI Stability**: Resolved circular dependency loops in `ServiceProvider.ts` that caused stack overflow errors.
- **Validation Logic**: Relaxed message schemas in `MessageValidator.ts` to support optional/null plan states during synchronization.
- **Activation Errors**: Fixed various "Service not registered" and naming conflicts during extension startup.

## [0.5.4] - 2026-03-14

### Added
- Added `ApplyBlockEditTool` (Multi-Hunk Block Editing), a powerful new editing tool replacing `SafeEditTool`, enabling multiple edits per single AI operation.
- Added overlap and conflict detection in `EditorEngine` to ensure data integrity during multiple modifications taking place concurrently.

### Changed
- `EditorEngine` now performs reverse-order hunk application to prevent index shifting.
- Improved robust fuzzy-matching using context and whitespace normalization in the editor.
- The Guardian checks are now fully integrated with quick validation during pre-apply previews.

### Fixed
- Fixed task synchronization between the Webview and `.md` plan files by adding a bidirectional parser (`MarkdownTaskParser`), a `FileSystemWatcher` in `PlanPersistenceService`, and GFM task list support in the `MessageBubble` Svelte component.

## [0.5.3] - 2026-03-12

### Fixed
- Fixed `XXHash64` state leak in `EmbeddingCache` by re-instantiating on each digest.
- Fixed `hnswlib-node` initialization parameters to match v3.0.0 API.
- Fixed `tsc` build errors by properly excluding maintenance scripts and reproduction files.
- Fixed outdated links and paths in `README.md`.

### Added
- Centralized `GentlyError` class for robust error handling.
- Centralized `OutputChannel` logging for better observability.
- `optionalDependencies` for native modules with graceful fallback to lexical search.
- Rate-limiting and execution timeouts for Guardian background tasks.
- `tsconfig.scripts.json` for separate script maintenance.

### Removed
- `compile_errors.txt` (legacy build artifact).
- `netlify.toml` (redundant web config).
- `repro_hnsw.js` and `repro_xxhash.js` (debug scripts).
