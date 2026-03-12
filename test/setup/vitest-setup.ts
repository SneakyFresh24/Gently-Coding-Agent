import { vi } from 'vitest';
import type { Mock } from 'vitest';

// Mock VS Code API
const mockVscode = {
  window: {
    createTextEditorDecorationType: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    withProgress: vi.fn(),
    activeTextEditor: undefined,
    textDocuments: []
  },
  workspace: {
    workspaceFolders: [
      {
        uri: { fsPath: '/test/workspace' },
        name: 'test-workspace'
      }
    ],
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => true)
    })),
    asRelativePath: vi.fn((path: string) => path),
    fs: {
      stat: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn()
    }
  },
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn()
  },
  env: {
    appName: 'VS Code Test'
  },
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path })),
    joinPath: vi.fn((uri: any, path: string) => ({ fsPath: `${uri.fsPath}/${path}` }))
  },
  Range: vi.fn(),
  Position: vi.fn(),
  Selection: vi.fn(),
  ProgressLocation: {
    Notification: 10
  },
  FileType: {
    File: 1,
    Directory: 2
  }
};

// Global mock setup
vi.mock('vscode', () => ({
  default: mockVscode,
  ...mockVscode
}));

// Mock console methods for cleaner test output
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

// Setup test utilities
export const createMockContext = () => ({
  subscriptions: [],
  workspaceState: {
    get: vi.fn(),
    update: vi.fn(),
    keys: vi.fn(() => [])
  },
  globalState: {
    get: vi.fn(),
    update: vi.fn(),
    keys: vi.fn(() => [])
  },
  extensionUri: { fsPath: '/test/extension' },
  extensionPath: '/test/extension',
  storageUri: { fsPath: '/test/storage' },
  globalStorageUri: { fsPath: '/test/global-storage' },
  logUri: { fsPath: '/test/logs' },
  logPath: '/test/logs',
  extensionMode: 1,
  secrets: {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn()
  }
});

export const createMockTool = (name: string, description: string) => ({
  name,
  description,
  parameters: { type: 'object', properties: {} },
  execute: vi.fn()
});

// Type assertions for mocks
declare module 'vitest' {
  export interface Assertion<T = any> {
    toBeValidTool(): T;
    toHaveBeenCalledWithTool(toolName: string): T;
  }
}

// Custom matchers
expect.extend({
  toBeValidTool(received: any) {
    const pass = received && 
      typeof received.name === 'string' && 
      typeof received.description === 'string' && 
      typeof received.execute === 'function';
    
    return {
      message: () => `expected ${received} to be a valid tool`,
      pass
    };
  },
  
  toHaveBeenCalledWithTool(received: Mock, toolName: string) {
    const calls = received.mock.calls;
    const pass = calls.some(call => call[0] === toolName);
    
    return {
      message: () => `expected mock to have been called with tool ${toolName}`,
      pass
    };
  }
});