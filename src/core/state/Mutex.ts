/**
 * Simple Mutex for ensuring atomic operations in asynchronous code.
 */
export class Mutex {
    private mutex = Promise.resolve();

    /**
     * Executes the given function while holding the lock.
     * Ensures only one function runs at a time.
     */
    async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
        let release: () => void;
        const lock = new Promise<void>(resolve => {
            release = resolve;
        });

        const previous = this.mutex;
        this.mutex = previous.then(() => lock);

        await previous;
        try {
            return await fn();
        } finally {
            release!();
        }
    }
}
