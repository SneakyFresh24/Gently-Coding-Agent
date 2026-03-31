import * as fs from 'fs/promises';
import * as path from 'path';

class InProcessMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class CheckpointLock {
  private static readonly mutexes = new Map<string, InProcessMutex>();

  private static getMutex(workspaceHash: string): InProcessMutex {
    let mutex = this.mutexes.get(workspaceHash);
    if (!mutex) {
      mutex = new InProcessMutex();
      this.mutexes.set(workspaceHash, mutex);
    }
    return mutex;
  }

  static async withWorkspaceLock<T>(
    workspaceHash: string,
    lockDir: string,
    fn: () => Promise<T>,
    timeoutMs = 30_000
  ): Promise<T> {
    const mutex = this.getMutex(workspaceHash);
    return mutex.runExclusive(async () => {
      await fs.mkdir(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, '.gently-checkpoint.lock');
      const start = Date.now();
      while (true) {
        let handle: fs.FileHandle | undefined;
        try {
          handle = await fs.open(lockPath, 'wx');
          break;
        } catch (error: any) {
          if (error?.code !== 'EEXIST') {
            throw error;
          }
          if (Date.now() - start > timeoutMs) {
            throw new Error('CHECKPOINT_LOCK_TIMEOUT');
          }
          const jitter = Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, 100 + jitter));
        } finally {
          await handle?.close();
        }
      }

      try {
        return await Promise.race<T>([
          fn(),
          new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error('CHECKPOINT_LOCK_TIMEOUT')), timeoutMs);
          })
        ]);
      } finally {
        await fs.rm(lockPath, { force: true });
      }
    });
  }
}
