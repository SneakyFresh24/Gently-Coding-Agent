/**
 * VS Code API Wrapper
 * Provides type-safe communication with the extension
 */

// VS Code API type definition
interface VSCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

class VSCodeAPIWrapper {
  private readonly api: VSCodeApi;

  constructor() {
    this.api = acquireVsCodeApi();
  }

  /**
   * Post a message to the extension
   */
  public postMessage(message: any): void {
    this.api.postMessage(message);
  }

  /**
   * Get the persistent state
   */
  public getState(): any {
    return this.api.getState();
  }

  /**
   * Set the persistent state
   */
  public setState(state: any): void {
    this.api.setState(state);
  }
}

// Export singleton instance
export const vscodeApi = new VSCodeAPIWrapper();

