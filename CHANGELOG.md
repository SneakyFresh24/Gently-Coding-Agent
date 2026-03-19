# Changelog

All notable changes to the "Gently" extension will be documented in this file.

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
