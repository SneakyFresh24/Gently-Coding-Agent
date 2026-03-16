/**
 * A debounced function that can be explicitly flushed.
 */
export interface DebouncedFunction<T extends (...args: any[]) => any> {
  /**
   * Triggers the debounced function.
   */
  trigger: (...args: Parameters<T>) => void;
  
  /**
   * Immediately executes the pending call if any, and clears the timeout.
   */
  flush: () => any;
  
  /**
   * Cancels the pending call.
   */
  cancel: () => void;
}

/**
 * Creates a debounced version of the provided function.
 * 
 * @param fn The function to debounce
 * @param delay The delay in milliseconds
 * @returns An object with trigger, flush, and cancel methods
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;

  const trigger = function(this: any, ...args: Parameters<T>) {
    lastArgs = args;
    lastThis = this;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      if (lastArgs) {
        fn.apply(lastThis, lastArgs);
        timeoutId = null;
        lastArgs = null;
      }
    }, delay);
  };

  const flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      const result = fn.apply(lastThis, lastArgs);
      timeoutId = null;
      lastArgs = null;
      return result;
    }
    return undefined;
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return { trigger, flush, cancel };
}
