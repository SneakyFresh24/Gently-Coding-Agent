import * as vscode from 'vscode';
import * as path from 'path';
import { Container } from './container';
import { FileOperations } from './fileOperations';
import { CodebaseIndexer } from './CodebaseIndexer';
import { ContextManager } from './contextManager';
import { FileReferenceManager } from './fileReferenceManager';
import { IncrementalIndexer } from './IncrementalIndexer';
import { MemoryManager as BaseMemoryManager } from './memory';
import { MemoryBankManager } from './memory/MemoryBankManager';
import { ValidationManager as BaseValidationManager } from './validation';
import { TransformersEmbeddingProvider } from './retrieval/TransformersEmbeddingProvider';
import { EmbeddingCache } from './retrieval/EmbeddingCache';
import { HNSWIndex } from './retrieval/HNSWIndex';
import { BM25Index } from './retrieval/BM25Index';
import { CrossEncoderReranker } from './retrieval/CrossEncoderReranker';
import { HybridRetriever } from './retrieval/HybridRetriever';
import { RegexSearchService } from './retrieval/RegexSearchService';
import { ProjectStructureAnalyzer } from './ProjectStructureAnalyzer';
import { GitDiffService } from './GitDiffService';
import { CheckpointManager } from './checkpoints/CheckpointManager';
import { EditorEngine } from './editors/EditorEngine';
import { ASTAnalyzer } from './ASTAnalyzer';
import { CodebaseMapGenerator } from './CodebaseMapGenerator';
import {
    ToolRegistry,
    FileTools,
    MemoryTools,
    ProjectTools,
    CheckpointTools,
    PlanningTools,
    MemoryBankTools,
    SafeEditTool,
    ApplyBlockEditTool,
    CommandTools,
    WebSearchTools,
    QuestionTools
} from './tools';
import {
    FileOperationManager,
    ToolManager,
    PlanningManager,
    ValidationManager,
    MemoryManager
} from './agentManager/index';
import { CONTEXT_LIMITS } from '../utils';
import { ApprovalManager, AutoApproveManager } from '../approval/ApprovalManager';
import { HookManager } from '../hooks/HookManager';
import { TokenTracker } from '../utils/TokenTracker';
import { CircuitBreakerRegistry } from '../core/resilience/CircuitBreakerRegistry';

/**
 * Configure all services in the container
 */
export function configureServices(container: Container, context: vscode.ExtensionContext): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    // 1. External dependencies
    container.force('context', context);
    container.force('workspaceRoot', workspaceRoot);

    // 1.5 Register Optional/Late-Bound Services (avoid "Service not registered" errors)
    container.register('terminalManager', () => undefined);
    container.register('openRouterService', () => undefined);
    container.register('agentSessions', (c) => {
        // This may be needed by minified components or plugins
        // We bridge it to the SessionManager if available in the global context, 
        // but for DI purposes we'll return the instance created in extension.ts if forced
        return undefined; 
    });

    container.register('approvalManager', (c) => new ApprovalManager(context, (m) => {
        const agentSessions = c.resolve<any>('agentSessions');
        if (agentSessions && typeof agentSessions.sendMessageToWebview === 'function') {
            agentSessions.sendMessageToWebview(m);
        }
    }));
    container.register('autoApproveManager', (c) => new AutoApproveManager(context));
    container.register('hookManager', (c) => new HookManager(workspaceRoot));
    container.register('tokenTracker', (c) => new TokenTracker(context));
    container.register('circuitBreakerRegistry', () => CircuitBreakerRegistry.getInstance());

    // 2. Base Services
    container.register('fileOps', () => new FileOperations());
    container.register('indexer', (c) => new CodebaseIndexer(c.resolve('fileOps'), c.resolve('hybridRetriever')));
    container.register('contextManager', () => new ContextManager(CONTEXT_LIMITS.DEFAULT_TOKEN_LIMIT));
    container.register('embeddingCache', () => new EmbeddingCache({ persistenceDir: path.join(workspaceRoot, '.gently', 'cache', 'embeddings') }));
    container.register('embeddingProvider', (c) => new TransformersEmbeddingProvider(c.resolve('embeddingCache')));
    container.register('hnswIndex', () => new HNSWIndex({
        dimensions: 384,
        persistenceDir: path.join(workspaceRoot, '.gently', 'index', 'hnsw'),
        quantize: 'float32' // Configurable via RetrievalConfig
    }));
    container.register('bm25Index', (c) => new BM25Index(c.resolve('astAnalyzer')));
    container.register('reranker', () => new CrossEncoderReranker());
    container.register('hybridRetriever', (c) => new HybridRetriever(
        c.resolve('hnswIndex'),
        c.resolve('bm25Index'),
        c.resolve('embeddingProvider'),
        c.resolve('reranker')
    ));

    container.register('baseMemoryManager', (c) => new BaseMemoryManager(
        c.resolve('workspaceRoot'),
        c.resolve('embeddingProvider'),
        c.resolve<any>('openRouterService')
    ));
    container.register('memoryBankManager', (c) => new MemoryBankManager(c.resolve('workspaceRoot')));
    container.register('fileReferenceManager', (c) => new FileReferenceManager(c.resolve('fileOps'), c.resolve('indexer')));
    container.register('incrementalIndexer', (c) => new IncrementalIndexer(c.resolve('indexer')));
    container.register('gitDiffService', (c) => new GitDiffService(c.resolve('workspaceRoot')));
    container.register('checkpointManager', (c) => new CheckpointManager(c.resolve('context'), c.resolve('gitDiffService')));
    container.register('astAnalyzer', (c) => new ASTAnalyzer(c.resolve('context'), c.resolve('fileOps')));
    container.register('editorEngine', (c) => new EditorEngine(
        c.resolve('fileOps'),
        c.resolve('astAnalyzer')
    ));
    container.register('projectAnalyzer', (c) => new ProjectStructureAnalyzer(c.resolve('workspaceRoot')));
    container.register('toolRegistry', () => new ToolRegistry());
    container.register('codebaseMapGenerator', (c) => new CodebaseMapGenerator(c.resolve('fileOps')));
    container.register('regexSearchService', (c) => new RegexSearchService(c.resolve('fileOps')));

    // 3. Tool Instances
    container.register('fileTools', (c) => new FileTools(
        c.resolve('fileOps'),
        c.resolve('indexer'),
        c.resolve('contextManager'),
        c.resolve('regexSearchService')
    ));
    container.register('memoryTools', (c) => new MemoryTools(c.resolve('baseMemoryManager')));
    container.register('memoryBankTools', (c) => new MemoryBankTools(c.resolve('memoryBankManager')));
    container.register('projectTools', (c) => new ProjectTools(c.resolve('projectAnalyzer')));
    container.register('checkpointTools', (c) => new CheckpointTools(c.resolve('checkpointManager')));
    container.register('planningTools', (c) => new PlanningTools(
        c.resolve('planningManager'),
        c.resolve<any>('terminalManager') || null,
        c.resolve('toolRegistry'),
        () => undefined
    ));
    container.register('safeEditTool', (c) => new SafeEditTool(
        c.resolve('fileOps'),
        c.resolve('contextManager'),
        c.resolve('editorEngine')
    ));
    container.register('applyBlockEditTool', (c) => new ApplyBlockEditTool(
        c.resolve('fileOps'),
        c.resolve('contextManager'),
        c.resolve('editorEngine')
    ));
    container.register('commandTools', (c) => new CommandTools(
        () => c.resolve<any>('terminalManager') || null,
        () => { } // Event callback will be set later via ToolManager
    ));
    container.register('webSearchTools', () => new WebSearchTools());
    container.register('questionTools', () => new QuestionTools());

    // 4. Managers
    container.register('fileOperationManager', (c) => new FileOperationManager(
        c.resolve('fileOps'),
        c.resolve('indexer'),
        c.resolve('contextManager'),
        c.resolve('fileReferenceManager'),
        c.resolve('incrementalIndexer')
    ));

    container.register('memoryManager', (c) => new MemoryManager(c.resolve('baseMemoryManager')));

    container.register('planningManager', () => new PlanningManager());

    container.register('toolManager', (c) => {
        const tm = new ToolManager(
            c.resolve('toolRegistry'),
            c.resolve('fileTools'),
            c.resolve('memoryTools'),
            c.resolve('projectTools'),
            c.resolve('checkpointTools'),
            c.resolve('planningTools'),
            c.resolve('planningManager'),
            c.resolve('memoryBankTools'),
            c.resolve('safeEditTool'),
            c.resolve('applyBlockEditTool'),
            c.resolve('commandTools'),
            c.resolve('webSearchTools'),
            c.resolve('questionTools'),
            c.resolve('autoApproveManager'),
            c.resolve('hookManager'),
            c.resolve('circuitBreakerRegistry')
        );

        const termManager = c.resolve<any>('terminalManager');
        if (termManager) {
            tm.setTerminalManager(termManager);
        }

        const pm = c.resolve<any>('planningManager');
        if (pm && typeof pm.setToolManager === 'function') {
            pm.setToolManager(tm);
        }

        return tm;
    });

    // 5. Validation (Requires OpenRouterService)
    container.register('validationManager', (c) => {
        const orService = c.resolve<any>('openRouterService');
        if (!orService) return undefined;

        const baseVM = new BaseValidationManager(orService, c.resolve('workspaceRoot'));
        return new ValidationManager(baseVM);
    });
}
