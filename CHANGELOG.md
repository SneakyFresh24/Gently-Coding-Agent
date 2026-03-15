# Changelog

All notable changes to the "Gently" extension will be documented in this file.
 
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
