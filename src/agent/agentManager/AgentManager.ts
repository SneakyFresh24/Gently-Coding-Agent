import * as vscode from 'vscode';
import { Container } from '../container';
import { configureServices } from '../ServiceProvider';
import { FileOperations, FileInfo } from '../fileOperations';
import { CodebaseIndexer, SearchResult } from '../CodebaseIndexer';
import { ContextManager } from '../contextManager';
import { FileReferenceManager } from '../fileReferenceManager';
import { IncrementalIndexer } from '../IncrementalIndexer';
import { MemoryManager as BaseMemoryManager, Memory, MemorySearchResult } from '../memory';
import { MemoryBankManager } from '../memory/MemoryBankManager';
import { ValidationManager as BaseValidationManager } from '../validation';
import { TerminalManager } from '../../terminal/TerminalManager';
import { OpenRouterService } from '../../services/OpenRouterService';
import { GitDiffService } from '../GitDiffService';
import { CheckpointManager } from '../checkpoints/CheckpointManager';
import { VerificationAgent } from '../verification/VerificationAgent';
import {
  FileOperationManager,
  ToolManager,
  PlanningManager,
  ValidationManager,
  MemoryManager,
  IAgentService
} from './index';
import { PlanManager, PlanEvent } from '../planning';
import {
  safeExecute,
  agentLogger,
  PerformanceLogger
} from '../../utils/Logger';
import { ensureDir } from '../../utils/persistenceUtils';
import * as path from 'path';

export interface AgentContext {
  workspaceRoot: string;
  openFiles: string[];
  currentFile?: string;
  selectedText?: string;
  relevantFiles: string[];
}

export interface AgentTool {
  name: string;
  category?: string;
  description: string;
  parameters: any;
  execute: (params: any) => Promise<any>;
}

/**
 * AgentManager - Thin facade for Gently Agent services using Dependency Injection
 */
export class AgentManager {
  private container: Container;
  private cachedRepoMap?: string;
  private lastRepoMapTime?: number;
  private eventCallback?: (event: PlanEvent) => void;

  constructor(private context: vscode.ExtensionContext) {
    agentLogger.info('Initializing AgentManager (DI Version)...');

    this.container = new Container();
    configureServices(this.container, context);

    agentLogger.info('AgentManager (DI) initialized');

    // Restore last state
    this.loadLastSessionState().catch(err => {
      agentLogger.error('Failed to load last session state', err);
    });
  }

  public getServiceProvider(): { getService: <T>(name: string) => T | undefined } {
    return {
      getService: <T>(name: string) => {
        try {
          return this.container.resolve<T>(name as any);
        } catch {
          return undefined;
        }
      }
    };
  }

  // --- Service Accessors ---

  public get memoryManager(): MemoryManager {
    return this.container.resolve('memoryManager');
  }

  public get validationManager(): BaseValidationManager | undefined {
    return this.container.resolve<ValidationManager>('validationManager')?.getBaseValidationManager();
  }

  public get baseMemoryManager(): BaseMemoryManager {
    return this.container.resolve('baseMemoryManager');
  }

  private get fileOps(): FileOperations {
    return this.container.resolve('fileOps');
  }

  // --- Lifecycle Methods ---

  async initialize(): Promise<void> {
    agentLogger.info('Initializing Gently Agent services...');
    return await PerformanceLogger.measure('agentInitialize', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gently: Initializing Services...',
          cancellable: false
        },
        async (progress) => {
          const services = [
            { name: 'File Operations', manager: this.container.resolve<FileOperationManager>('fileOperationManager') },
            { name: 'Memory', manager: this.memoryManager },
            { name: 'Planning', manager: this.container.resolve<PlanningManager>('planningManager') },
            { name: 'Tools', manager: this.container.resolve<ToolManager>('toolManager') }
          ];

          const memoryIndexDir = path.join(this.fileOps.getWorkspaceRoot(), '.gently', 'memory-index');
          await ensureDir(memoryIndexDir);

          for (let i = 0; i < services.length; i++) {
            const { name, manager } = services[i];
            try {
              progress.report({ message: `Initializing ${name}...`, increment: (100 / services.length) });
              if (manager.initialize) {
                await manager.initialize();
              }
            } catch (err) {
              agentLogger.error(`Non-critical service ${name} failed to initialize`, err);
              // We move on to the next service
            }
          }

          // Bridge CheckpointManager to PlanManager
          const planManager = this.container.resolve<any>('planManager');
          const checkpointManager = this.container.resolve<any>('checkpointManager');
          if (planManager && checkpointManager) {
            planManager.setCheckpointManager(checkpointManager);
          }
        }
      );
    });
  }

  async initializeValidation(openRouterService: OpenRouterService): Promise<void> {
    return await safeExecute(
      async () => {
        agentLogger.info('Initializing validation system via DI...');
        this.container.force('openRouterService', openRouterService);

        const vm = this.container.resolve<ValidationManager>('validationManager');
        if (vm) await vm.initialize();

        agentLogger.info('Validation system initialized');
      },
      undefined,
      'initializeValidation'
    ) ?? Promise.resolve();
  }

  // --- Core Methods ---

  async getContext(): Promise<AgentContext> {
    return await safeExecute(
      async () => {
        const workspaceRoot = this.fileOps.getWorkspaceRoot();
        const openFiles = vscode.workspace.textDocuments.map(doc => vscode.workspace.asRelativePath(doc.uri));
        const activeEditor = vscode.window.activeTextEditor;
        const currentFile = activeEditor ? vscode.workspace.asRelativePath(activeEditor.document.uri) : undefined;
        const selectedText = activeEditor?.selection && !activeEditor.selection.isEmpty
          ? activeEditor.document.getText(activeEditor.selection)
          : undefined;

        return { workspaceRoot, openFiles, currentFile, selectedText, relevantFiles: [] };
      },
      { workspaceRoot: '', openFiles: [], currentFile: undefined, selectedText: undefined, relevantFiles: [] },
      'getContext'
    ) ?? { workspaceRoot: '', openFiles: [], currentFile: undefined, selectedText: undefined, relevantFiles: [] };
  }

  async executeTool(toolName: string, params: any): Promise<any> {
    return this.container.resolve<ToolManager>('toolManager').executeTool(toolName, params);
  }

  getAvailableTools(): AgentTool[] {
    return this.container.resolve<ToolManager>('toolManager').getAvailableTools();
  }

  getFormattedTools(): any[] {
    return this.container.resolve<ToolManager>('toolManager').getFormattedTools();
  }

  getPlanningOnlyTools(): any[] {
    return this.container.resolve<ToolManager>('toolManager').getPlanningOnlyTools();
  }

  getToolsForPrompt(): string {
    return this.container.resolve<ToolManager>('toolManager').getToolsForPrompt();
  }

  setTerminalManager(terminalManager: TerminalManager): void {
    this.container.force('terminalManager', terminalManager);
    this.container.resolve<ToolManager>('toolManager').setTerminalManager(terminalManager);

    // Bridge GuardianService if it already exists
    const guardianService = this.container.resolve<any>('guardianService');
    if (guardianService && (terminalManager as any).setGuardianService) {
      (terminalManager as any).setGuardianService(guardianService);
    }

    agentLogger.info('Terminal manager updated in DI container and bridged');
  }

  getTerminalManager(): TerminalManager | undefined {
    return this.container.resolve<any>('terminalManager');
  }

  setGuardianService(guardianService: any): void {
    this.container.force('guardianService', guardianService);

    // Bridge to TerminalManager if it exists
    const terminalManager = this.container.resolve<any>('terminalManager');
    if (terminalManager && terminalManager.setGuardianService) {
      terminalManager.setGuardianService(guardianService);
    }

    agentLogger.info('Guardian service updated in DI container and bridged');
  }

  setEventCallback(callback: (event: PlanEvent) => void): void {
    this.eventCallback = callback;
    this.container.resolve<ToolManager>('toolManager').setEventCallback(callback);
    this.container.resolve<PlanningManager>('planningManager').setEventCallback(callback);
  }

  setCurrentModeProvider(provider: () => string | undefined): void {
    this.container.resolve<ToolManager>('toolManager').setCurrentModeProvider(provider);
  }

  // --- Delegation Methods ---

  getFileOperations(): FileOperations {
    return this.fileOps;
  }

  getGitDiffService(): GitDiffService {
    return this.container.resolve('gitDiffService');
  }

  getCheckpointManager(): CheckpointManager {
    return this.container.resolve('checkpointManager');
  }

  shouldUseIterativePlanning(goal: string): boolean {
    return this.container.resolve<PlanningManager>('planningManager').getPlanManager().shouldUseIterativePlanning(goal);
  }

  async getMemoryBankContext(): Promise<string> {
    return await this.container.resolve<MemoryBankManager>('memoryBankManager').getFormattedContext();
  }

  async updateMemoryBank(category: string, content: string, append: boolean = false): Promise<void> {
    const manager = this.container.resolve<MemoryBankManager>('memoryBankManager');
    if (append) {
      await manager.appendMemoryBank(category, content);
    } else {
      await manager.writeMemoryBank(category, content);
    }
  }

  async createCheckpoint(messageId: string, description: string, filePaths: string[], sessionId?: string): Promise<any> {
    return await this.container.resolve<CheckpointManager>('checkpointManager').createCheckpoint(messageId, description, filePaths, sessionId);
  }

  async restoreCheckpoint(id: string): Promise<any> {
    return await this.container.resolve<CheckpointManager>('checkpointManager').restoreCheckpoint(id);
  }

  setValidationMessageCallback(callback: (msg: string) => void): void {
    // VerificationAgent does not support message callbacks — this is a no-op.
    agentLogger.info('setValidationMessageCallback called — VerificationAgent has no callback support yet');
  }

  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  getValidationMetrics(): any {
    return this.validationManager?.getMetrics?.();
  }

  async addMemory(content: string, source: 'manual' | 'automatic' | 'agent' = 'manual', category?: any, scope?: any): Promise<Memory> {
    return this.memoryManager.addMemory(content, source, category, scope);
  }

  async getRelevantMemories(context: string, maxCount: number = 5, memoryContext?: any): Promise<MemorySearchResult[]> {
    return this.memoryManager.getRelevantMemories(context, maxCount, memoryContext);
  }

  async clearAllMemories(): Promise<void> {
    return this.memoryManager.clearAllMemories();
  }

  getMemory(id: string): Memory | undefined {
    return this.memoryManager.getMemory(id);
  }

  async deleteMemory(id: string): Promise<boolean> {
    return this.memoryManager.deleteMemory(id);
  }

  getAllMemories(): Memory[] {
    return this.memoryManager.getAllMemories();
  }

  getMemoryStats(): any {
    return this.memoryManager.getStats();
  }

  async updateMemory(id: string, content: string, category?: any): Promise<Memory | null> {
    return this.memoryManager.updateMemory(id, content, category);
  }

  async recordGuardianInsight(insight: any): Promise<void> {
    try {
      const description = typeof insight === 'string' ? insight : insight?.description || JSON.stringify(insight);
      await this.addMemory(`Guardian Insight: ${description}`, 'agent', 'general');
    } catch (e) {
      agentLogger.error('Failed to record guardian insight', e);
    }
  }

  async readFile(filePath: string): Promise<FileInfo> {
    return this.container.resolve<FileOperationManager>('fileOperationManager').readFile(filePath);
  }

  async findRelevantFiles(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    return this.container.resolve<FileOperationManager>('fileOperationManager').findRelevantFiles(query, maxResults);
  }

  async indexWorkspace(progressCallback?: (progress: number, total: number) => void): Promise<void> {
    return this.container.resolve<FileOperationManager>('fileOperationManager').indexWorkspace(progressCallback);
  }

  pinFile(filePath: string): void {
    this.container.resolve<FileOperationManager>('fileOperationManager').pinFile(filePath);
  }

  unpinFile(filePath: string): void {
    this.container.resolve<FileOperationManager>('fileOperationManager').unpinFile(filePath);
  }

  getTrackedFiles(): any[] {
    return this.container.resolve<FileOperationManager>('fileOperationManager').getTrackedFiles();
  }

  getContextStats(): any {
    return this.container.resolve<FileOperationManager>('fileOperationManager').getContextStats();
  }

  // --- Accessors for specialized managers (requested by other components) ---

  getIndexer(): CodebaseIndexer {
    return this.container.resolve('indexer');
  }

  onIndexUpdate(callback: () => void): void {
    this.container.resolve<FileOperationManager>('fileOperationManager').onIndexUpdate(callback);
  }

  getContextManager(): ContextManager {
    return this.container.resolve('contextManager');
  }

  getFileReferenceManager(): FileReferenceManager {
    return this.container.resolve('fileReferenceManager');
  }

  getIncrementalIndexer(): IncrementalIndexer {
    return this.container.resolve('incrementalIndexer');
  }

  async getRepoMapForPrompt(): Promise<string> {
    const workspaceRoot = this.fileOps.getWorkspaceRoot();
    if (!workspaceRoot) return '';

    const mapper = this.container.resolve<any>('codebaseMapGenerator');
    const now = Date.now();

    if (this.cachedRepoMap && this.lastRepoMapTime && (now - this.lastRepoMapTime < 5 * 60 * 1000)) {
      return this.cachedRepoMap;
    }

    try {
      const map = await mapper.generateMap(workspaceRoot);
      this.cachedRepoMap = `\n\n--- REPOSITORY SEMANTIC MAP ---\nThis is a map of the key structures in the project (Classes, Interfaces, Types, exported Functions).\n\n${map}\n-------------------------------\n\n`;
      this.lastRepoMapTime = now;
      return this.cachedRepoMap;
    } catch (error) {
      agentLogger.error('Failed to generate repo map:', error);
      return '';
    }
  }

  getToolManager(): ToolManager {
    return this.container.resolve('toolManager');
  }

  getPlanningManager(): PlanningManager {
    return this.container.resolve('planningManager');
  }

  getPlanManager(): PlanManager {
    return this.container.resolve<PlanningManager>('planningManager').getPlanManager();
  }

  async executeGoalIteratively(goal: string, tools: Map<string, any>, llmProvider: OpenRouterService): Promise<unknown> {
    return this.container.resolve<PlanningManager>('planningManager').executeGoalIteratively(goal, tools, llmProvider);
  }

  getFileOperationManager(): FileOperationManager {
    return this.container.resolve('fileOperationManager');
  }

  private async loadLastSessionState(): Promise<void> {
    const lastPlanId = this.context.globalState.get<string>('lastActivePlanId');
    if (!lastPlanId) return;

    agentLogger.info(`Found last active plan ID: ${lastPlanId}`);
    try {
      const planningManager = this.container.resolve<PlanningManager>('planningManager');
      const planManager = planningManager.getPlanManager();

      const plan = await planManager.loadPlanFromMarkdown(lastPlanId);
      if (plan) {
        agentLogger.info(`Successfully restored plan: ${lastPlanId}`);
        planManager.setCurrentPlanId(lastPlanId);

        // Emit event to notify UI
        if (this.eventCallback) {
          this.eventCallback({ type: 'planLoaded', planId: lastPlanId, plan });
        }

        // Resume auto-execution if it was running
        if (plan.status === 'executing') {
          agentLogger.info(`Resuming auto-execution for plan: ${lastPlanId}`);
          await planManager.startAutoExecution(lastPlanId);
        }
      }
    } catch (error) {
      agentLogger.error(`Failed to restore last session state for plan ${lastPlanId}`, error);
    }
  }

  public async saveCurrentState(): Promise<void> {
    try {
      const planningManager = this.container.resolve<PlanningManager>('planningManager');
      const planManager = planningManager.getPlanManager();
      const currentPlanId = planManager.getCurrentPlanId();

      if (currentPlanId) {
        agentLogger.info(`Saving current active plan ID: ${currentPlanId}`);
        await this.context.globalState.update('lastActivePlanId', currentPlanId);
      }
    } catch (error) {
      agentLogger.error('Failed to save current state', error);
    }
  }

  dispose(): void {
    agentLogger.info('Disposing agent resources...');

    // Save state before disposing
    this.saveCurrentState().catch(err => {
      agentLogger.error('Error saving state during dispose', err);
    });

    try {
      this.container.resolve<ToolManager>('toolManager')?.dispose();
      this.container.resolve<PlanningManager>('planningManager')?.dispose();
      this.container.resolve<ValidationManager>('validationManager')?.dispose();
      this.container.resolve<FileOperationManager>('fileOperationManager')?.dispose();
      agentLogger.info('Agent resources disposed');
    } catch (error) {
      agentLogger.error('Error disposing agent resources:', error);
    }
  }
}

