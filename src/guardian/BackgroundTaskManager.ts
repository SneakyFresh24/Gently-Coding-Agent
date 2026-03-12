/**
 * Background Task Manager
 * 
 * Manages background analysis tasks with intelligent scheduling,
 * resource management, and performance optimization
 */

import { EventEmitter } from 'events';
import { GuardianAnalysisContext, GuardianAnalysisResult } from './types';
import { GuardianService } from './GuardianService';

interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  context: GuardianAnalysisContext;
  createdAt: number;
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  timeout: number;
}

enum TaskType {
  INCREMENTAL_ANALYSIS = 'incremental_analysis',
  FULL_ANALYSIS = 'full_analysis',
  BATCH_ANALYSIS = 'batch_analysis'
}

enum TaskPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4
}

interface TaskQueue {
  [TaskPriority.CRITICAL]: Task[];
  [TaskPriority.HIGH]: Task[];
  [TaskPriority.NORMAL]: Task[];
  [TaskPriority.LOW]: Task[];
}

export interface ResourceLimits {
  maxMemoryUsage: number; // MB
  maxCpuUsage: number; // percentage
}

export interface SchedulingConfig {
  idleTimeThreshold: number; // ms
  busyTimeThreshold: number; // ms
  adaptiveScheduling: boolean;
}

export interface BackgroundTaskConfig {
  enabled: boolean;
  maxConcurrentTasks: number;
  taskTimeout: number;
  retryDelay: number;
  resourceLimits: ResourceLimits;
  scheduling: SchedulingConfig;
}

const DEFAULT_CONFIG: BackgroundTaskConfig = {
  enabled: true,
  maxConcurrentTasks: 2,
  taskTimeout: 300000, // 5 minutes
  retryDelay: 10000, // 10 seconds (increased for stability)
  resourceLimits: {
    maxMemoryUsage: 512, // MB (base)
    maxCpuUsage: 50 // percentage (reduced for better background behavior)
  },
  scheduling: {
    idleTimeThreshold: 1000, // 1 second
    busyTimeThreshold: 500, // 500ms
    adaptiveScheduling: true
  }
};

export class BackgroundTaskManager extends EventEmitter {
  private config: BackgroundTaskConfig;
  private guardianService: GuardianService;
  private taskQueue: TaskQueue;
  private runningTasks: Map<string, Task> = new Map();
  private completedTasks: Map<string, Task> = new Map();
  private isProcessing: boolean = false;
  private processingTimer?: NodeJS.Timeout;
  private performanceMonitor: PerformanceMonitor;
  private scheduler: TaskScheduler;

  constructor(
    guardianService: GuardianService,
    config?: Partial<BackgroundTaskConfig>
  ) {
    super();
    this.guardianService = guardianService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.taskQueue = {
      [TaskPriority.CRITICAL]: [],
      [TaskPriority.HIGH]: [],
      [TaskPriority.NORMAL]: [],
      [TaskPriority.LOW]: []
    };

    this.performanceMonitor = new PerformanceMonitor(this.config.resourceLimits);
    this.scheduler = new TaskScheduler(this.config.scheduling);

    console.log('[BackgroundTaskManager] Initialized');
  }

  /**
   * Start the background task manager
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[BackgroundTaskManager] Disabled, not starting');
      return;
    }

    this.startProcessing();
    this.performanceMonitor.start();
    this.scheduler.start();

    console.log('[BackgroundTaskManager] Started');
  }

  /**
   * Stop the background task manager
   */
  stop(): void {
    this.stopProcessing();
    this.performanceMonitor.stop();
    this.scheduler.stop();

    console.log('[BackgroundTaskManager] Stopped');
  }

  /**
   * Schedule a new analysis task
   */
  scheduleTask(
    context: GuardianAnalysisContext,
    priority: TaskPriority = TaskPriority.NORMAL,
    taskType: TaskType = TaskType.INCREMENTAL_ANALYSIS
  ): string {
    const task: Task = {
      id: this.generateTaskId(),
      type: taskType,
      priority,
      context,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
      timeout: this.config.taskTimeout
    };

    this.taskQueue[priority].push(task);

    console.log(`[BackgroundTaskManager] Scheduled task ${task.id} with priority ${priority}`);

    // Trigger processing if not already running
    if (!this.isProcessing) {
      this.startProcessing();
    }

    this.emit('taskScheduled', task);
    return task.id;
  }

  /**
   * Schedule incremental analysis for changed files
   */
  scheduleIncrementalAnalysis(changedFiles: string[]): string {
    const context: GuardianAnalysisContext = {
      workspaceRoot: '',
      changedFiles,
      fullAnalysis: false,
      timestamp: Date.now()
    };

    return this.scheduleTask(context, TaskPriority.HIGH, TaskType.INCREMENTAL_ANALYSIS);
  }

  /**
   * Schedule full workspace analysis
   */
  scheduleFullAnalysis(): string {
    const context: GuardianAnalysisContext = {
      workspaceRoot: '',
      changedFiles: [],
      fullAnalysis: true,
      timestamp: Date.now()
    };

    return this.scheduleTask(context, TaskPriority.NORMAL, TaskType.FULL_ANALYSIS);
  }

  /**
   * Schedule batch analysis for multiple files
   */
  scheduleBatchAnalysis(files: string[]): string {
    const context: GuardianAnalysisContext = {
      workspaceRoot: '',
      changedFiles: files,
      fullAnalysis: false,
      timestamp: Date.now()
    };

    return this.scheduleTask(context, TaskPriority.LOW, TaskType.BATCH_ANALYSIS);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    // Remove from queue if not started
    for (const priority of Object.values(TaskPriority)) {
      const index = this.taskQueue[priority as TaskPriority].findIndex((task: Task) => task.id === taskId);
      if (index >= 0) {
        const task = this.taskQueue[priority as TaskPriority].splice(index, 1)[0];
        this.emit('taskCancelled', task);
        return true;
      }
    }

    // Check if task is running
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) {
      // Note: In practice, you'd need to implement task cancellation
      // This is a simplified implementation
      this.emit('taskCancelRequested', runningTask);
      return true;
    }

    return false;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): TaskStatus | null {
    // Check running tasks
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) {
      return {
        task: runningTask,
        status: 'running',
        progress: 0 // In practice, you'd track progress
      };
    }

    // Check queue
    for (const priority of Object.values(TaskPriority)) {
      const task = this.taskQueue[priority as TaskPriority].find((t: Task) => t.id === taskId);
      if (task) {
        return {
          task,
          status: 'queued',
          progress: 0
        };
      }
    }

    // Check completed tasks
    const completedTask = this.completedTasks.get(taskId);
    if (completedTask) {
      return {
        task: completedTask,
        status: 'completed',
        progress: 100
      };
    }

    return null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): Task[] {
    const queuedTasks = Object.values(this.taskQueue).flat();
    const runningTasks = Array.from(this.runningTasks.values());
    const completedTasks = Array.from(this.completedTasks.values());

    return [...queuedTasks, ...runningTasks, ...completedTasks];
  }

  /**
   * Start processing tasks
   */
  private startProcessing(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.processingTimer = setInterval(() => {
      this.processTasks();
    }, 1000); // Check every second

    console.log('[BackgroundTaskManager] Started task processing');
  }

  /**
   * Stop processing tasks
   */
  private stopProcessing(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = undefined;
    }

    this.isProcessing = false;
    console.log('[BackgroundTaskManager] Stopped task processing');
  }

  /**
   * Process tasks from the queue
   */
  private async processTasks(): Promise<void> {
    // Check resource availability
    if (!this.performanceMonitor.canStartNewTask()) {
      return;
    }

    // Check if we can start more tasks
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
      return;
    }

    // Get next task
    const nextTask = this.getNextTask();
    if (!nextTask) {
      return;
    }

    // Check if it's a good time to run the task
    if (!this.scheduler.shouldRunTask(nextTask)) {
      // Re-queue at original priority if scheduler delays it
      this.taskQueue[nextTask.priority].push(nextTask);
      return;
    }

    // Start the task
    this.startTask(nextTask);
  }

  /**
   * Get the next task from the queue
   */
  private getNextTask(): Task | null {
    // Check priorities in order
    for (const priority of [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.NORMAL,
      TaskPriority.LOW
    ]) {
      if (this.taskQueue[priority].length > 0) {
        return this.taskQueue[priority].shift() || null;
      }
    }

    return null;
  }

  /**
   * Start executing a task
   */
  private async startTask(task: Task): Promise<void> {
    task.startedAt = Date.now();
    this.runningTasks.set(task.id, task);

    console.log(`[BackgroundTaskManager] Starting task ${task.id}`);
    this.emit('taskStarted', task);

    try {
      // Execute the task
      const result = await this.executeTask(task);

      // Mark as completed
      task.completedAt = Date.now();
      this.runningTasks.delete(task.id);
      this.completedTasks.set(task.id, task);

      console.log(`[BackgroundTaskManager] Completed task ${task.id} in ${task.completedAt - task.startedAt}ms`);
      this.emit('taskCompleted', task, result);

      // Clean up old completed tasks
      this.cleanupCompletedTasks();

    } catch (error) {
      console.error(`[BackgroundTaskManager] Task ${task.id} failed:`, error);

      // Handle retry
      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.scheduledAt = Date.now() + this.config.retryDelay;

        // Re-queue with lower priority
        const retryPriority = Math.max(TaskPriority.LOW, task.priority - 1) as TaskPriority;
        this.taskQueue[retryPriority].push(task);

        console.log(`[BackgroundTaskManager] Retrying task ${task.id} (${task.retryCount}/${task.maxRetries})`);
        this.emit('taskRetry', task);
      } else {
        // Mark as failed
        task.completedAt = Date.now();
        this.runningTasks.delete(task.id);
        this.completedTasks.set(task.id, task);

        console.log(`[BackgroundTaskManager] Task ${task.id} failed after ${task.maxRetries} retries`);
        this.emit('taskFailed', task, error);
      }
    }
  }

  /**
   * Execute a task
   */
  private async executeTask(task: Task): Promise<GuardianAnalysisResult> {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
        }
      }, task.timeout);

      this.guardianService.performAnalysis(
        task.context.changedFiles,
        task.context.fullAnalysis
      )
        .then(result => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            resolve(result);
          }
        })
        .catch(error => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            reject(error);
          }
        });
    });
  }

  /**
   * Clean up old completed tasks
   */
  private cleanupCompletedTasks(): void {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const [id, task] of this.completedTasks) {
      if (task.completedAt && (now - task.completedAt) > maxAge) {
        this.completedTasks.delete(id);
      }
    }
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BackgroundTaskConfig>): void {
    this.config = { ...this.config, ...config };
    this.performanceMonitor.updateConfig(this.config.resourceLimits);
    this.scheduler.updateConfig(this.config.scheduling);
    console.log('[BackgroundTaskManager] Configuration updated');
  }

  /**
   * Get statistics
   */
  getStats(): BackgroundTaskStats {
    const queuedTasks = Object.values(this.taskQueue).flat().length;
    const runningTasks = this.runningTasks.size;
    const completedTasks = this.completedTasks.size;

    return {
      queuedTasks,
      runningTasks,
      completedTasks,
      totalTasks: queuedTasks + runningTasks + completedTasks,
      performanceStats: this.performanceMonitor.getStats(),
      schedulerStats: this.scheduler.getStats()
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
    console.log('[BackgroundTaskManager] Disposed');
  }
}

interface TaskStatus {
  task: Task;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
}

interface BackgroundTaskStats {
  queuedTasks: number;
  runningTasks: number;
  completedTasks: number;
  totalTasks: number;
  performanceStats: PerformanceStats;
  schedulerStats: SchedulingStats;
}

export interface PerformanceStats {
  memoryUsage: number;
  cpuUsage: number;
  isActive: boolean;
}

export interface SchedulingStats {
  isIdleTime: boolean;
  isBusyTime: boolean;
  lastActivityTime: number;
}

/**
 * Performance Monitor
 * Monitors system resources and determines if new tasks can be started
 */
class PerformanceMonitor {
  private config: ResourceLimits;
  private stats: PerformanceStats;
  private monitoringTimer?: NodeJS.Timeout;

  constructor(config: ResourceLimits) {
    this.config = config;
    this.stats = {
      memoryUsage: 0,
      cpuUsage: 0,
      isActive: false
    };
  }

  start(): void {
    this.stats.isActive = true;
    this.monitoringTimer = setInterval(() => {
      this.updateStats();
    }, 5000); // Update every 5 seconds
  }

  stop(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
    }
    this.stats.isActive = false;
  }

  canStartNewTask(): boolean {
    return (
      this.stats.memoryUsage < this.config.maxMemoryUsage &&
      this.stats.cpuUsage < this.config.maxCpuUsage
    );
  }

  private updateStats(): void {
    // Simplified implementation
    // In practice, you'd use actual system monitoring
    this.stats.memoryUsage = Math.random() * 100;
    this.stats.cpuUsage = Math.random() * 100;
  }

  getStats(): PerformanceStats {
    return { ...this.stats };
  }

  updateConfig(config: Partial<ResourceLimits>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Task Scheduler
 * Determines optimal timing for task execution
 */
class TaskScheduler {
  private config: SchedulingConfig;
  private stats: SchedulingStats;
  private schedulingTimer?: NodeJS.Timeout;

  constructor(config: SchedulingConfig) {
    this.config = config;
    this.stats = {
      isIdleTime: false,
      isBusyTime: false,
      lastActivityTime: Date.now()
    };
  }

  start(): void {
    this.schedulingTimer = setInterval(() => {
      this.updateStats();
    }, 1000);
  }

  stop(): void {
    if (this.schedulingTimer) {
      clearInterval(this.schedulingTimer);
      this.schedulingTimer = undefined;
    }
  }

  shouldRunTask(task: Task): boolean {
    if (!this.config.adaptiveScheduling) {
      return true;
    }

    // Priority-based scheduling
    if (task.priority === TaskPriority.CRITICAL) {
      return true;
    }

    // Time-based scheduling
    if (this.stats.isIdleTime) {
      return true;
    }

    if (this.stats.isBusyTime && task.priority < TaskPriority.HIGH) {
      return false;
    }

    return true;
  }

  private updateStats(): void {
    const now = Date.now();
    const timeSinceLastActivity = now - this.stats.lastActivityTime;

    this.stats.isIdleTime = timeSinceLastActivity > this.config.idleTimeThreshold;
    this.stats.isBusyTime = timeSinceLastActivity < this.config.busyTimeThreshold;
    this.stats.lastActivityTime = now;
  }

  getStats(): SchedulingStats {
    return { ...this.stats };
  }

  updateConfig(config: Partial<SchedulingConfig>): void {
    this.config = { ...this.config, ...config };
  }
}