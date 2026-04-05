# Gently - AI Coding Agent (v0.10.3)

Privacy-first VS Code Extension mit BYOK-Zugriff auf OpenRouter-Modelle.  
Gently kombiniert planbasiertes Arbeiten (Architect), Ausführung mit Tools (Code), Memory Bank, Checkpoints und resiliente Tool-Orchestrierung.

[![Version](https://img.shields.io/badge/version-0.10.3-blue)](https://marketplace.visualstudio.com/items?itemName=gently.gently)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![VS Code](https://img.shields.io/badge/vscode-%5E1.85.0-007ACC)](https://code.visualstudio.com/)

## Features

- **Architect- und Code-Mode**
  - `Architect`: Planung, Analyse, Plan-Erstellung (`create_plan`)
  - `Code`: Umsetzung mit Datei-/Projekt-Tools
  - PLAN -> ACT Übergang wird blockiert, wenn kein persistierter Plan vorhanden ist
- **Tool-gestützte Ausführung**
  - Dateioperationen (`read_file`, `apply_block_edit`, `safe_edit_file`, `write_file`)
  - Projektanalyse und Suche (`analyze_project_structure`, `find_files`, `regex_search`)
  - Plan- und Workflow-Tools (`create_plan`, `update_plan_steps`, `handover_to_coder`, `ask_question`)
  - Checkpoint-Tools (erstellen, diffen, wiederherstellen)
- **Memory-System**
  - Kurz- und Langzeitwissen
  - Persistente Memory Bank unter `.gently/memory-bank/*.md`
- **Session-Historie**
  - Chat-/Plan-Sessions inkl. Metadaten werden lokal gespeichert
- **Observability & Resilience**
  - Diagnostik-Snapshot und Reset als Commands
  - Robuste Retry-/Recovery-Pfade für Stream-, Tool- und Subagent-Fehler
- **Plugin-System**
  - Eingebaute Plugins: `git`, `docker`
  - Externe Plugins über `.gently/plugins`

## Voraussetzungen

- VS Code `^1.85.0`
- Node.js 18+
- OpenRouter API Key

## Installation

### Marketplace

1. Extensions öffnen (`Ctrl+Shift+X`)
2. Nach `Gently - AI Coding Agent` suchen
3. Installieren

### VSIX

```bash
code --install-extension gently-0.10.3.vsix
```

## Quickstart

1. OpenRouter-Key erstellen: <https://openrouter.ai>
2. In VS Code `Gently: Configure OpenRouter API Key` ausführen
3. Gently-View öffnen (`Gently: Open Gently Chat`)
4. Modell auswählen (`gently.selectedModel`, z. B. `deepseek/deepseek-chat`)
5. Mit einer Aufgabe starten, z. B.:
   - `Analysiere dieses Projekt und erstelle einen Umsetzungsplan`
   - `Implementiere Schritt 1 aus dem Plan`

## Befehle (Command Palette)

- `Gently: Open Gently Chat` (`gently.openChat`)
- `Clear Chat History` (`gently.clearHistory`)
- `Toggle Agent Mode` (`gently.toggleAgentMode`)
- `Configure OpenRouter API Key` (`gently.configureApiKey`)
- `Gently: Observability Snapshot` (`gently.observability.snapshot`)
- `Gently: Reset Observability Buffers` (`gently.observability.reset`)

## Wichtige Settings

Diese Auswahl basiert auf den aktuell im Extension-Manifest deklarierten Settings:

- Modell & Ausgabe
  - `gently.selectedModel`
  - `gently.temperature`
  - `gently.maxTokens`
- Mode & Planung
  - `gently.agentMode`
  - `gently.modeStateMachineV2`
  - `gently.planning.requireApproval`
  - `gently.modeRouting.planModelDefault`
  - `gently.modeRouting.codeModelDefault`
- Prompt-Pipeline
  - `gently.promptPipeline.enabled`
  - `gently.promptPipeline.variant`
  - `gently.promptPipeline.promptId`
  - `gently.promptPipeline.familyOverrides`
  - `gently.promptContractV2`
- Validierung
  - `gently.validation.enabled`
  - `gently.validation.strictMode`
- Resilience/Runtime
  - `gently.resilience.contextRecoveryV2`
  - `gently.resilience.toolOrchestratorV2`
  - `gently.resilience.subagentOrchestratorV1`
  - `gently.resilience.strictResponseGuards`
- Performance/Pruning
  - `gently.pruning.strategy`
  - `gently.pruning.maxHistoryLength`
  - `gently.performance.adaptivePromptVariant`
- Model Policies
  - `gently.modelPolicies.reasoningEffort`
  - `gently.modelPolicies.providerCaching.enabled`
  - `gently.modelPolicies.geminiSchemaSanitization.enabled`

Hinweis: Die vollständige Liste steht in [`package.json`](package.json) unter `contributes.configuration.properties`.

## Lokale Daten & Persistenz

Gently ist local-first. Typische Datenpfade im Workspace:

- Sessions: `.gently/sessions/*.json`
- Aktive Sessions: `.gently/sessions/active-sessions.json`
- Memory Bank: `.gently/memory-bank/*.md`
- Embedding Cache: `.gently/cache/embeddings`
- Retrieval Index: `.gently/index/hnsw`
- Observability: `.gently/observability`
- Error Logs: `.gently/error-log`

API-Key wird in VS Code Secret Storage abgelegt (`gently.openrouter.apiKey`), nicht im Repository.

## Architektur (High-Level)

```text
VS Code Extension (src/extension.ts)
  -> ChatViewProvider (Webview Bridge)
  -> AgentManager (Tool-/Runtime-Orchestrierung)
  -> OpenRouterService (LLM API)
  -> ModeService (Architect/Code)
  -> HistoryManager (.gently/sessions)
  -> PluginLoader (git/docker + externe Plugins)

Webview UI (webview-ui, Svelte 5)
  -> Chat
  -> History
  -> Settings
  -> Guardian View (UI-seitig vorhanden)
```

## Entwicklung

### Setup

```bash
# Root
npm install

# Webview UI
cd webview-ui
npm install
cd ..
```

### Build

```bash
npm run build
```

### Nützliche Scripts

```bash
npm run build:extension
npm run build:webview
npm run compile
npm run lint
npm run test
npm run resilience:release-gate
npm run resilience:hardening-gate
npm run resilience:soak
```

Webview-spezifisch:

```bash
cd webview-ui
npm run dev
npm run build
npm run check
```

### VS Code Extension lokal starten

1. Projekt in VS Code öffnen
2. `F5` drücken (Extension Development Host)
3. Im neuen Fenster Gently über Activity Bar öffnen

## Projektstruktur

```text
src/
  agent/          # Agent Core, Tools, Retrieval, Memory, Planning, Checkpoints
  views/chat/     # Chat Provider, Runtime, Handler, Toolcall-Flows
  modes/          # Architect/Code Mode + Contracts
  terminal/       # Command-Ausführung + Approval-Flows
  services/       # OpenRouter, History, Diagnostics, API-Key
  plugins/        # Plugin-System + Built-ins
  commands/       # VS Code Commands

webview-ui/       # Svelte-Frontend
scripts/          # Build-/Gate-/Utility-Skripte
docs/             # Runbooks und technische Dokus
```

## Bekannte Hinweise

- Terminal-Safety-Evaluierung ist aktuell konservativ: bei unbekannter Sicherheit wird explizite Freigabe benötigt.
- Einige ältere Doku-/UI-Texte im Projekt sind historisch und nicht mehr versionsaktuell; diese README bildet den aktuellen Kernstand (`0.10.3`) ab.

## Lizenz

MIT - siehe [`LICENSE`](LICENSE)

## Repository

<https://github.com/SneakyFresh24/Gently-Coding-Agent>
