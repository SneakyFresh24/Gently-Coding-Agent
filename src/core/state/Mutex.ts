/**
 * Simple async mutex to serialize state access.
 */
export class Mutex {
    private promise: Promise<void> | null = null;

    async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
        const previousPromise = this.promise;
        let resolveNext: (() => void) | null = null;
        this.promise = new Promise<void>((resolve) => {
            resolveNext = resolve;
        });

        if (previousPromise) {
            await previousPromise;
        }

        try {
            return await callback();
        } finally {
            if (resolveNext) {
                (resolveNext as () => void)();
            }
        }
    }
}
