import { ContentChunk, UsageInfo } from './types';

/**
 * Coordinates content chunks and usage reporting during streaming.
 * Provides a way to separate different types of data arriving in the same stream.
 */
export class StreamChunkCoordinator {
    private contentQueue: ContentChunk[] = [];
    private finalUsage?: UsageInfo;
    private resolveNextChunk?: (chunk: ContentChunk | undefined) => void;

    /**
     * Adds a content chunk (text or reasoning) to the queue.
     */
    enqueue(chunk: ContentChunk): void {
        if (this.resolveNextChunk) {
            this.resolveNextChunk(chunk);
            this.resolveNextChunk = undefined;
        } else {
            this.contentQueue.push(chunk);
        }
    }

    /**
     * Retrieves the next available content chunk, waiting if necessary.
     */
    async nextChunk(): Promise<ContentChunk | undefined> {
        if (this.contentQueue.length > 0) {
            return this.contentQueue.shift();
        }

        return new Promise(resolve => {
            this.resolveNextChunk = resolve;
        });
    }

    /**
     * Reports final usage information.
     */
    reportUsage(usage: UsageInfo): void {
        this.finalUsage = usage;
    }

    /**
     * Gets the reported usage.
     */
    getUsage(): UsageInfo | undefined {
        return this.finalUsage;
    }

    /**
     * Signals the end of the content stream.
     */
    end(): void {
        if (this.resolveNextChunk) {
            this.resolveNextChunk(undefined);
            this.resolveNextChunk = undefined;
        }
    }
}
