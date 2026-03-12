import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LazyLoader } from './lazyLoader';

describe('LazyLoader', () => {
    let loader: LazyLoader;

    beforeEach(() => {
        loader = new LazyLoader();
    });

    describe('registerModule', () => {
        it('should register a module and load it on demand', async () => {
            const factory = vi.fn().mockResolvedValue({ data: 'ok' });
            const mod = loader.registerModule('test', factory);

            expect(mod.isLoaded).toBe(false);
            const instance = await mod.get();
            expect(instance).toEqual({ data: 'ok' });
            expect(mod.isLoaded).toBe(true);
            expect(factory).toHaveBeenCalledOnce();
        });
    });

    describe('Retry Logic', () => {
        it('should retry on failure with exponential backoff', async () => {
            const factory = vi.fn()
                .mockRejectedValueOnce(new Error('Fail 1'))
                .mockRejectedValueOnce(new Error('Fail 2'))
                .mockResolvedValue({ data: 'success' });

            const mod = loader.registerModule('retry-test', factory, {
                retryAttempts: 2,
                retryDelay: 10 // Short delay for tests
            });

            const instance = await mod.get();
            expect(instance).toEqual({ data: 'success' });
            expect(factory).toHaveBeenCalledTimes(3);
        });

        it('should throw after max retries', async () => {
            const factory = vi.fn().mockRejectedValue(new Error('Eternal Failure'));
            const mod = loader.registerModule('fail-test', factory, {
                retryAttempts: 2,
                retryDelay: 1
            });

            await expect(mod.get()).rejects.toThrow('Eternal Failure');
            expect(factory).toHaveBeenCalledTimes(3); // Initial + 2 retries
        });
    });

    describe('Priority Preloading', () => {
        it('should preload modules in priority order', async () => {
            const order: string[] = [];
            const createLoader = (id: string) => async () => {
                order.push(id);
                return { id };
            };

            loader.registerModule('low', createLoader('low'), { priority: 0 });
            loader.registerModule('high', createLoader('high'), { priority: 10 });
            loader.registerModule('mid', createLoader('mid'), { priority: 5 });

            await loader.preloadModules(['low', 'high', 'mid']);

            expect(order).toEqual(['high', 'mid', 'low']);
        });
    });
});
