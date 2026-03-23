# Changelog

All notable changes to the "Gently" extension will be documented in this file.

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
