// =====================================================
// VS Code API Wrapper – singleton for webview communication
// =====================================================

interface VsCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

// VS Code injects this function into webviews
declare function acquireVsCodeApi(): VsCodeApi;

class VsCodeApiWrapper {
  private readonly api: VsCodeApi;

  constructor() {
    this.api = acquireVsCodeApi();
  }

  postMessage(message: any): void {
    this.api.postMessage(message);
  }

  getState<T = any>(): T | undefined {
    return this.api.getState() as T | undefined;
  }

  setState<T = any>(state: T): T {
    this.api.setState(state);
    return state;
  }
}

// Singleton instance
export const vscodeApi = new VsCodeApiWrapper();
