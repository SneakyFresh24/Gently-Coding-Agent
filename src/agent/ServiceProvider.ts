import * as vscode from 'vscode';
import * as path from 'path';
import { Container } from './container';
import { FileOperations } from './fileOperations';
import { CodebaseIndexer } from './CodebaseIndexer';
import { ContextManager } from './contextManager';
import { FileReferenceManager } from './fileReferenceManager';
import { IncrementalIndexer } from './IncrementalIndexer';
import { PlanManager } from './planning';
import { MemoryManager as BaseMemoryManager } from './memory';
import { MemoryBankManager } from './memory/MemoryBankManager';
import { ValidationManager as BaseValidationManager } from './validation';
import { TransformersEmbeddingProvider } from './retrieval/TransformersEmbeddingProvider';
import { EmbeddingCache } from './retrieval/EmbeddingCache';
import { HNSWIndex } from './retrieval/HNSWIndex';
import { BM25Index } from './retrieval/BM25Index';
import { CrossEncoderReranker } from './retrieval/CrossEncoderReranker';
import { HybridRetriever } from './retrieval/HybridRetriever';
import { ProjectStructureAnalyzer } from './ProjectStructureAnalyzer';
import { GitDiffService } from './GitDiffService';
import { CheckpointManager } from './checkpoints/CheckpointManager';
import { VerificationAgent } from './verification/VerificationAgent';
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
    VerificationTools,
    MemoryBankTools,
    SafeEditTool,
    CommandTools
} from './tools';
import {
    FileOperationManager,
    ToolManager,
    PlanningManager,
    ValidationManager,
    MemoryManager
} from './agentManager/index';
import { CONTEXT_LIMITS } from '../utils';

/**
 * Configure all services in the container
 */
export function configureServices(container: Container, context: vscode.ExtensionContext): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    // 1. External dependencies
    container.force('context', context);
    container.force('workspaceRoot', workspaceRoot);

    // 1.5 Register Optional/Late-Bound Services (avoid "Service not registered" errors)
    container.register('guardianService', () => undefined);
    container.register('terminalManager', () => undefined);
    container.register('openRouterService', () => undefined);
    container.register('agentSessions', (c) => {
        // This may be needed by minified components or plugins
        // We bridge it to the SessionManager if available in the global context, 
        // but for DI purposes we'll return the instance created in extension.ts if forced
        return undefined; 
    });

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
    container.register('planManager', () => new PlanManager());
    container.register('gitDiffService', (c) => new GitDiffService(c.resolve('workspaceRoot')));
    container.register('checkpointManager', (c) => new CheckpointManager(c.resolve('context'), c.resolve('gitDiffService')));
    container.register('astAnalyzer', (c) => new ASTAnalyzer(c.resolve('context'), c.resolve('fileOps')));
    container.register('editorEngine', (c) => new EditorEngine(
        c.resolve('fileOps'),
        c.resolve('astAnalyzer'),
        c.resolve<any>('guardianService') // This is now safe because we registered it above
    ));
    container.register('projectAnalyzer', (c) => new ProjectStructureAnalyzer(c.resolve('workspaceRoot')));
    container.register('toolRegistry', () => new ToolRegistry());
    container.register('codebaseMapGenerator', (c) => new CodebaseMapGenerator(c.resolve('fileOps')));

    // 3. Tool Instances
    container.register('fileTools', (c) => new FileTools(
        c.resolve('fileOps'),
        c.resolve('indexer'),
        c.resolve('contextManager')
    ));
    container.register('memoryTools', (c) => new MemoryTools(c.resolve('baseMemoryManager')));
    container.register('memoryBankTools', (c) => new MemoryBankTools(c.resolve('memoryBankManager')));
    container.register('projectTools', (c) => new ProjectTools(c.resolve('projectAnalyzer')));
    container.register('checkpointTools', (c) => new CheckpointTools(c.resolve('checkpointManager')));
    container.register('verificationTools', (c) => new VerificationTools(() => c.resolve('verificationAgent')));
    container.register('planningTools', (c) => new PlanningTools(
        c.resolve('planManager'),
        c.resolve<any>('terminalManager') || null, // Robust resolution
        () => { },
        c.resolve('toolRegistry')
    ));
    container.register('safeEditTool', (c) => new SafeEditTool(
        c.resolve('fileOps'),
        c.resolve('contextManager'),
        c.resolve('editorEngine')
    ));
    container.register('commandTools', (c) => new CommandTools(
        () => c.resolve<any>('terminalManager') || null,
        () => { } // Event callback will be set later via ToolManager
    ));

    // 4. Managers
    container.register('fileOperationManager', (c) => new FileOperationManager(
        c.resolve('fileOps'),
        c.resolve('indexer'),
        c.resolve('contextManager'),
        c.resolve('fileReferenceManager'),
        c.resolve('incrementalIndexer')
    ));

    container.register('memoryManager', (c) => new MemoryManager(c.resolve('baseMemoryManager')));

    container.register('planningManager', (c) => {
        const pm = new PlanningManager(c.resolve('planManager'), null!);
        pm.setToolManager(c.resolve('toolManager'));
        return pm;
    });

    container.register('toolManager', (c) => {
        const tm = new ToolManager(
            c.resolve('toolRegistry'),
            c.resolve('fileTools'),
            c.resolve('memoryTools'),
            c.resolve('projectTools'),
            c.resolve('checkpointTools'),
            c.resolve('planningTools'),
            c.resolve('planManager'),
            c.resolve('verificationTools'),
            c.resolve('memoryBankTools'),
            c.resolve('safeEditTool'),
            c.resolve('commandTools')
        );

        const termManager = c.resolve<any>('terminalManager');
        if (termManager) {
            tm.setTerminalManager(termManager);
        }

        const pm = c.resolve<any>('planManager');
        if (pm && typeof pm.setToolManager === 'function') {
            pm.setToolManager(tm);
        }

        return tm;
    });

    // 5. Validation/Verification (Requires OpenRouterService)
    container.register('verificationAgent', (c) => {
        const orService = c.resolve<any>('openRouterService');
        if (!orService) return undefined;

        return new VerificationAgent(
            orService,
            c.resolve<any>('terminalManager') || null,
            c.resolve('fileOps'),
            c.resolve('workspaceRoot')
        );
    });

    container.register('validationManager', (c) => {
        const orService = c.resolve<any>('openRouterService');
        if (!orService) return undefined;

        const baseVM = new BaseValidationManager(orService, c.resolve('workspaceRoot'));
        return new ValidationManager(baseVM);
    });
}
