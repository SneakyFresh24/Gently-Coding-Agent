import { window, OutputChannel, Disposable } from 'vscode';
import { Cache, sessionCache, chatCache, workspaceCache } from './cache';

/**
 * Performance configuration
 */
export interface PerformanceConfig {
  memoryCheckInterval: number; // ms
  metricsReportInterval: number; // ms
  pacingThreshold: number; // % heap usage
  criticalThreshold: number; // % heap usage
  scaleThreshold: number; // % heap usage
}

const DEFAULT_CONFIG: PerformanceConfig = {
  memoryCheckInterval: 30000,
  metricsReportInterval: 300000,
  pacingThreshold: 75,
  criticalThreshold: 85,
  scaleThreshold: 80
};

/**
 * Performance optimization system for the agent
 */
export class PerformanceOptimizer implements Disposable {
  private outputChannel: OutputChannel;
  private disposables: Disposable[] = [];
  private lastPacingCheck = 0;
  private pacingResult = false;
  private config: PerformanceConfig;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.outputChannel = window.createOutputChannel('Gently Performance');
    this.disposables.push(this.outputChannel);

    this.log('Performance Optimizer started (Adaptive Mode)');

    // Periodic reporting
    const reportInterval = setInterval(() => this.reportMetrics(), this.config.metricsReportInterval);
    this.disposables.push({ dispose: () => clearInterval(reportInterval) });

    // Memory monitoring
    const memoryInterval = setInterval(() => this.checkMemoryUsage(), this.config.memoryCheckInterval);
    this.disposables.push({ dispose: () => clearInterval(memoryInterval) });
  }

  /**
   * Check if high-load operations should be paced
   */
  isPacingRequired(): boolean {
    const now = Date.now();
    if (now - this.lastPacingCheck < 5000) return this.pacingResult;

    const memory = process.memoryUsage();
    const heapUsedPct = (memory.heapUsed / memory.heapTotal) * 100;

    this.pacingResult = heapUsedPct > this.config.pacingThreshold;
    this.lastPacingCheck = now;

    if (this.pacingResult) {
      this.log(`[WARNING] High memory usage detected (${heapUsedPct.toFixed(1)}%). Pacing active.`);
    }

    return this.pacingResult;
  }

  /**
   * Optimize memory usage
   */
  async optimizeMemory(): Promise<void> {
    const memory = process.memoryUsage();
    const heapUsedPct = (memory.heapUsed / memory.heapTotal) * 100;

    if (heapUsedPct > this.config.criticalThreshold) {
      this.log('Critical memory pressure: clearing non-essential caches');
      sessionCache.clear();
    }

    this.adjustTtlBasedOnMemory(heapUsedPct);
  }

  /**
   * Adjust cache behaviour based on memory usage
   */
  private adjustTtlBasedOnMemory(heapUsedPct: number): void {
    let scale = 1.0;
    if (heapUsedPct > 90) scale = 0.2;
    else if (heapUsedPct > this.config.scaleThreshold) scale = 0.5;

    if (scale < 1.0) {
      this.log(`Memory scaling active: reducing cache footprints (Scale: ${scale})`);
    }

    // Actually apply the scale to the global Cache class
    Cache.setGlobalTtlScale(scale);
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  private reportMetrics(): void {
    const memory = process.memoryUsage();
    const sessionStats = sessionCache.getStats();
    const chatStats = chatCache.getStats();
    const workspaceStats = workspaceCache.getStats();

    this.log('-- Performance Report --');
    this.log(`Heap: ${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(memory.heapTotal / 1024 / 1024).toFixed(1)}MB`);
    this.log(`Session Cache: HitRate=${sessionStats.hitRate.toFixed(1)}%, Size=${sessionStats.size}`);
    this.log(`Chat Cache: HitRate=${chatStats.hitRate.toFixed(1)}%, Size=${chatStats.size}`);
    this.log(`Workspace Cache: HitRate=${workspaceStats.hitRate.toFixed(1)}%, Size=${workspaceStats.size}`);
    this.log('------------------------');
  }

  private checkMemoryUsage(): void {
    if (this.isPacingRequired()) {
      this.optimizeMemory();
    } else {
      // Restore scale if memory is healthy
      Cache.setGlobalTtlScale(1.0);
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

export const performanceOptimizer = new PerformanceOptimizer();