/**
 * Retry logic utility types.
 */

export interface RetryOptions {
    maxRetries: number;
    delay: number;
    backoff?: boolean;
}
