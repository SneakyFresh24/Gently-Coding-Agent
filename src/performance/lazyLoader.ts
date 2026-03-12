// =====================================================
// Lazy Loader for Modules
// =====================================================

import { Disposable } from 'vscode';

/**
 * Interface for lazy-loaded modules
 */
export interface LazyModule<T> {
  instance: T | null;
  loadPromise: Promise<T> | null;
  isLoaded: boolean;
  isLoading: boolean;
  priority?: number;
  load(attempt?: number): Promise<T>;
  get(): Promise<T>;
}

export interface LazyLoaderOptions {
  preloadTimeout?: number;
  preload?: boolean;
  priority?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Class for managing lazy-loaded modules
 */
export class LazyLoader implements Disposable {
  private modules = new Map<string, LazyModule<any>>();
  private preloadTimeouts = new Map<string, NodeJS.Timeout>();
  private disposables: Disposable[] = [];

  /**
   * Register a module for lazy loading
   * @param id Unique identifier for the module
   * @param loader Function that loads the module
   * @param options Options for lazy loading
   * @returns Lazy module instance
   */
  registerModule<T>(
    id: string,
    loader: () => Promise<T>,
    options: LazyLoaderOptions = {}
  ): LazyModule<T> {
    const module: LazyModule<T> = {
      instance: null,
      loadPromise: null,
      isLoaded: false,
      isLoading: false,
      /**
       * Loads the module with retry logic.
       * @param attempt Current retry attempt (internal use).
       */
      load: async (attempt: number = 0): Promise<T> => {
        if (module.isLoaded) return module.instance!;
        if (module.isLoading && attempt === 0) return module.loadPromise!;

        module.isLoading = true;
        module.loadPromise = loader();

        try {
          const instance = await module.loadPromise;
          module.instance = instance;
          module.isLoaded = true;
          module.isLoading = false;
          return instance;
        } catch (error) {
          const maxRetries = options.retryAttempts ?? 3;
          if (attempt < maxRetries) {
            const delay = (options.retryDelay ?? 1000) * Math.pow(2, attempt);
            console.warn(`[LazyLoader] Load failed for ${id}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return module.load(attempt + 1);
          }

          module.isLoading = false;
          module.loadPromise = null;
          throw error;
        }
      },
      get: (): Promise<T> => {
        return module.load();
      }
    };

    module.priority = options.priority ?? 0;
    this.modules.set(id, module);

    // Preload if requested (honoring priority)
    if (options.preload) {
      const waitTime = options.preloadTimeout ?? 0;
      const timeout = setTimeout(() => {
        this.loadModule(id).catch(() => { });
      }, waitTime);

      this.preloadTimeouts.set(id, timeout);
    }

    return module;
  }

  /**
   * Get a module by ID
   */
  getModule<T>(id: string): LazyModule<T> | null {
    return this.modules.get(id) || null;
  }

  /**
   * Check if a module is loaded
   */
  isModuleLoaded(id: string): boolean {
    const module = this.modules.get(id);
    return module?.isLoaded || false;
  }

  /**
   * Load a module manually
   */
  async loadModule<T>(id: string): Promise<T> {
    const module = this.modules.get(id);
    if (!module) {
      throw new Error(`Module not found: ${id}`);
    }

    return module.load();
  }

  /**
   * Preload multiple modules in priority order
   */
  async preloadModules(ids: string[]): Promise<void> {
    const modulesToLoad = ids
      .map(id => ({ id, mod: this.modules.get(id) }))
      .filter(m => m.mod && !m.mod.isLoaded)
      .sort((a, b) => (b.mod!.priority ?? 0) - (a.mod!.priority ?? 0));

    // Load sequentially by priority or in small batches? 
    // Let's do priority batches (same priority at once)
    const priorityGroups = new Map<number, string[]>();
    for (const item of modulesToLoad) {
      const p = item.mod!.priority ?? 0;
      const group = priorityGroups.get(p) || [];
      group.push(item.id);
      priorityGroups.set(p, group);
    }

    const priorities = Array.from(priorityGroups.keys()).sort((a, b) => b - a);
    for (const p of priorities) {
      const groupIds = priorityGroups.get(p)!;
      await Promise.all(groupIds.map(id => this.loadModule(id).catch(() => { })));
    }
  }

  /**
   * Unload a module
   * @param id Module ID
   */
  unloadModule(id: string): void {
    const module = this.modules.get(id);
    if (module) {
      module.instance = null;
      module.isLoaded = false;
      module.isLoading = false;
      module.loadPromise = null;
    }

    const timeout = this.preloadTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.preloadTimeouts.delete(id);
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Clear all modules
    this.modules.clear();

    // Clear all timeouts
    this.preloadTimeouts.forEach(timeout => clearTimeout(timeout));
    this.preloadTimeouts.clear();

    // Dispose all disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

// Global lazy loader instance
export const lazyLoader = new LazyLoader();