// =====================================================
// VSCode API Mock for Unit Tests
// =====================================================

import { vi } from 'vitest';

// Mock VS Code commands
export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
  getCommands: vi.fn(() => Promise.resolve([]))
};

// Mock VS Code window
export const window = {
  createTextEditorDecorationType: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  withProgress: vi.fn(),
  activeTextEditor: undefined,
  textDocuments: [],
  registerTreeDataProvider: vi.fn(),
  createOutputChannel: vi.fn()
};

// Mock VS Code workspace
export const workspace = {
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
  },
  onDidChangeConfiguration: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidSaveTextDocument: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  findFiles: vi.fn(),
  getWorkspaceFolder: vi.fn()
};

// Mock VS Code env
export const env = {
  appName: 'VS Code Test',
  openExternal: vi.fn()
};

// Mock VS Code Uri
export const Uri = {
  file: vi.fn((path: string) => ({ fsPath: path })),
  joinPath: vi.fn((uri: any, path: string) => ({ fsPath: `${uri.fsPath}/${path}` })),
  parse: vi.fn(),
};

// Mock VS Code Range
export const Range = vi.fn();

// Mock VS Code Position
export const Position = vi.fn();

// Mock VS Code Selection
export const Selection = vi.fn();

// Mock VS Code ProgressLocation
export const ProgressLocation = {
  Notification: 10
};

// Mock VS Code FileType
export const FileType = {
  File: 1,
  Directory: 2,
  SymbolicLink: 64
};

// Mock VS Code TabInputWebview
export const TabInputWebview = vi.fn();

// Mock VS Code ExtensionContext
export const ExtensionContext = vi.fn();

// Mock VS Code Disposable
export const Disposable = vi.fn();

// Mock VS Code EventEmitter
export const EventEmitter = vi.fn();

// Default export
export default {
  commands,
  window,
  workspace,
  env,
  Uri,
  Range,
  Position,
  Selection,
  ProgressLocation,
  FileType,
  TabInputWebview,
  ExtensionContext,
  Disposable,
  EventEmitter
};