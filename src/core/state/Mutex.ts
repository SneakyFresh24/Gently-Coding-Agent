/**
 * Simple async mutex to serialize state access.
 */
export class Mutex {
    private locked = false;
    private readonly waiters: Array<{
        resolve: (release: () => void) => void;
        reject: (error: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
    }> = [];

    async runExclusive<T>(callback: () => Promise<T> | T, timeoutMs?: number): Promise<T> {
        const release = await this.acquire(timeoutMs);
        try {
            return await callback();
        } finally {
            release();
        }
    }

    private async acquire(timeoutMs?: number): Promise<() => void> {
        if (!this.locked) {
            this.locked = true;
            return this.createRelease();
        }

        return new Promise<() => void>((resolve, reject) => {
            const waiter = { resolve, reject } as {
                resolve: (release: () => void) => void;
                reject: (error: Error) => void;
                timer?: ReturnType<typeof setTimeout>;
            };

            if (typeof timeoutMs === 'number' && timeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0) this.waiters.splice(index, 1);
                    reject(new Error(`Mutex acquire timeout after ${timeoutMs}ms`));
                }, timeoutMs);
            }

            this.waiters.push(waiter);
        });
    }

    private createRelease(): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;

            const next = this.waiters.shift();
            if (next) {
                if (next.timer) clearTimeout(next.timer);
                next.resolve(this.createRelease());
                return;
            }

            this.locked = false;
        };
    }
}
