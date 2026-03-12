# Gently 🧠 (v0.5.3)

> The privacy-first AI agent for VS Code with integrated semantic search, architectural guardrails, and deterministic code analysis.
[![Version](https://img.shields.io/badge/version-0.5.3-blue)](https://marketplace.visualstudio.com/items?itemName=gently.gently)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![VS Code](https://img.shields.io/badge/vscode-^1.85.0-007ACC)](https://code.visualstudio.com/)

> **Your affordable, local-first AI coding assistant** — powered by DeepSeek, Claude, OPENAI GPT, and more via OpenRouter.

## ✨ Key Features

### 🤖 AI-Powered Coding Assistant
- **Smart Chat Interface**: Natural conversation with AI about your code
- **Code Generation**: Generate, explain, and refactor code with context awareness
- **Streaming Responses**: Real-time AI responses for instant feedback
- **BYOK (Bring Your Own Key)**: Use your own OpenRouter API key — no account required

### 🛡️ Guardian System — Proactive Code Health
- **Automated Analysis**: Background scanning for code quality issues
- **Multi-Analyzer Architecture**:
  - Code Duplication Detection
  - Dead Code Identification
  - Security Pattern Analysis
  - Performance Issue Detection
  - Architectural Drift Monitoring
- **Quick Fixes**: Automated suggestions for common issues
- **Configurable**: Adjust severity thresholds, analysis intervals, and issue types

### 🧠 Advanced Retrieval & Memory
- **Hybrid Search**: Combines BM25 (lexical) and HNSW (semantic) search
- **Cross-Encoder Reranking**: Precision-optimized result ranking
- **Persistent Memory**: Context and decisions preserved across sessions
- **Memory Bank**: Structured storage for project knowledge

### 🔌 Extensible Plugin System
- **Built-in Plugins**: Git, Docker integration
- **Custom Plugins**: Extend functionality with your own plugins
- **Mode System**: Switch between Code and Architect modes

### ⚡ Performance Optimized
- **Lazy Loading**: Components loaded on demand
- **Intelligent Caching**: LRU cache for embeddings and search results
- **Session Management**: Optimized memory usage for long sessions

## 🚀 Quick Start

### 1. Installation

**From VS Code Marketplace:**
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Gently"
4. Click Install

**From VSIX:**
```bash
code --install-extension gently-0.5.3.vsix
```

### 2. Configuration

1. **Get an OpenRouter API Key**:
   - Visit [openrouter.ai](https://openrouter.ai)
   - Create an account and generate an API key

2. **Configure in VS Code**:
   - Click the Gently icon in the Activity Bar
   - Click "Configure API Key"
   - Enter your OpenRouter API key

3. **Select a Model** (optional):
   - Default: `deepseek/deepseek-chat`
   - Alternatives: `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`

### 3. Start Using

```
# Open chat
Ctrl+Shift+P → "Open Gently Chat"

# Example prompts:
"Explain this function"
"How can I optimize this code?"
"Write a unit test for this class"
"What does this error mean?"
"Refactor this to use async/await"
```

## 🏗️ Architecture

### Architecture Overview

Gently is built with a modular, service-oriented architecture:

- **Agent Core**: [src/agent/agentManager](file:///c:/Users/Bekim%20Lika/Desktop/Agent/src/agent/agentManager)
- **Guardian System**: [src/guardian](file:///c:/Users/Bekim%20Lika/Desktop/Agent/src/guardian)
- **Retrieval Engine**: [src/agent/retrieval](file:///c:/Users/Bekim%20Lika/Desktop/Agent/src/agent/retrieval)
- **DI Container**: [src/agent/ServiceProvider.ts](file:///c:/Users/Bekim%20Lika/Desktop/Agent/src/agent/ServiceProvider.ts)
- **Tool Registry**: Extensible tool system | `src/agent/tools/ToolRegistry.ts`
- **Memory Manager**: Persistent context storage | `src/agent/memory/MemoryManager.ts`
- **Plugin Manager**: Extensible plugin system | `src/plugins/PluginManager.ts`
- **Mode Service**: AI mode management | `src/modes/ModeService.ts`

### Retrieval Pipeline

```
User Query
    │
    ▼
┌─────────────────────────────────────────────┐
│  Stage 1: Parallel Coarse Retrieval         │
│  ┌─────────────┐    ┌─────────────┐         │
│  │   HNSW      │    │    BM25     │         │
│  │  (Dense)    │    │  (Lexical)  │         │
│  └──────┬──────┘    └──────┬──────┘         │
└─────────┼─────────────────┼────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────┐
│  Stage 2: Reciprocal Rank Fusion (RRF)      │
│  Weighted combination of dense + lexical    │
└─────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  Stage 3: Cross-Encoder Reranking           │
│  Precision optimization with bge-reranker   │
└─────────────────────────────────────────────┘
          │
          ▼
     Final Results
```

## ⚙️ Configuration

### VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gently.temperature` | number | 0.7 | AI response creativity (0.0-2.0) |
| `gently.maxTokens` | number | 8000 | Maximum response tokens |
| `gently.agentMode` | boolean | false | Enable autonomous agent mode |
| `gently.selectedModel` | string | deepseek/deepseek-chat | OpenRouter model slug |
| `gently.validation.enabled` | boolean | true | Enable code validation |
| `gently.guardian.enabled` | boolean | true | Enable Guardian monitoring |
| `gently.guardian.autoStart` | boolean | true | Auto-start Guardian on activation |
| `gently.guardian.analysisInterval` | number | 300000 | Analysis interval (ms) |
| `gently.guardian.severityThreshold` | string | medium | Minimum severity level |
| `gently.guardian.enabledIssueTypes` | array | [...] | Issue types to detect |

### Guardian Issue Types

- `code_duplication`: Detects repeated code patterns
- `dead_code`: Identifies unused code
- `architectural_drift`: Monitors architectural consistency
- `security_pattern`: Scans for security vulnerabilities
- `performance_issue`: Detects performance bottlenecks
- `maintainability`: Code maintainability analysis
- `test_coverage`: Test coverage gaps

## 🛠️ Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+
- TypeScript 5.3+

### Setup

```bash
# Clone repository
git clone https://github.com/gently-ai/gently-vscode-extension.git
cd gently-vscode-extension

# Install dependencies
npm install

# Build extension
npm run build

# Run tests
npm run test:unit
npm run test:guardian
npm run test:toolcall

# Watch mode for development
npm run watch
```

### Project Structure

```
src/
├── agent/                 # AI Agent system
│   ├── agentManager/      # Agent orchestration
│   ├── memory/            # Memory & context management
│   ├── retrieval/         # Hybrid search system
│   ├── tools/             # Tool registry & implementations
│   ├── validation/        # Code validation
│   └── planning/          # Task planning
├── guardian/              # Code health monitoring
│   ├── analyzers/         # Issue detection analyzers
│   ├── views/             # Guardian webview
│   └── tests/             # Guardian tests
├── views/                 # Webview providers
│   └── chat/              # Chat interface
├── plugins/               # Plugin system
├── modes/                 # AI mode system
├── session/               # Session management
├── performance/           # Performance optimization
├── commands/              # Command handlers
└── utils/                 # Utility functions
```

### Testing

```bash
# Unit tests
npm run test:unit

# Guardian tests
npm run test:guardian

# ToolCall tests
npm run test:toolcall

# All tests with coverage
npm run test:toolcall:coverage

# Watch mode
npm run test:toolcall:watch
```

### Building

```bash
# Production build
npm run build

# Package for distribution
npm run package
```

## 🔒 Privacy & Security

- **Direct Communication**: All API calls go directly to OpenRouter
- **Encrypted Communication**: HTTPS for all API calls
- **No Code Storage**: Your code is never stored on external servers
- **Local Settings**: API keys stored securely in VS Code Secret Storage
- **Guardian Security**: Built-in security pattern analysis

## 📊 Performance

### Benchmarks

| Metric | Value | Notes |
|--------|-------|-------|
| Search Latency | <50ms | For typical codebase |
| Index Build Time | ~2s/1000 files | Initial indexing |
| Memory Usage | ~150MB | Base extension |
| Guardian Analysis | ~5min | Default interval |

### Optimization Features

- **Lazy Loading**: Components loaded on demand
- **Embedding Cache**: LRU cache for embeddings
- **Incremental Indexing**: Only changed files re-indexed
- **Session Optimization**: Memory management for long sessions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- TypeScript strict mode
- ESLint for linting
- Vitest for testing
- Conventional commits

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Email**: info@illiria.eu
- **Gently VS Code Extension**: [SneakyFresh24/Gently-Coding-Agent](https://github.com/SneakyFresh24/Gently-Coding-Agent)
- **Gently Retrieval Engine**: [SneakyFresh24/Gently-Coding-Agent](https://github.com/SneakyFresh24/Gently-Coding-Agent) (Integrated)
- **Gently Guardian System**: [SneakyFresh24/Gently-Coding-Agent](https://github.com/SneakyFresh24/Gently-Coding-Agent) (Integrated)

## 🙏 Acknowledgments

- [OpenRouter](https://openrouter.ai) for AI model access
- [HNSWLib](https://github.com/nicehash/hnswlib-node) for vector search
- [Transformers.js](https://github.com/xenova/transformers.js) for embeddings
- [Tree-sitter](https://tree-sitter.github.io/) for AST parsing

---

Made with ❤️ by the Gently Team