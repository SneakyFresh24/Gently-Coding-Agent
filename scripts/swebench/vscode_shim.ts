import * as fs from 'fs';
import * as path from 'path';

type UriLike = { fsPath: string; path: string; toString(): string };

class Position {
  constructor(public line: number, public character: number) {}
}

class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

type EditOp =
  | { kind: 'replace'; uri: UriLike; range: Range; text: string }
  | { kind: 'insert'; uri: UriLike; position: Position; text: string }
  | { kind: 'createFile'; uri: UriLike; overwrite: boolean }
  | { kind: 'deleteFile'; uri: UriLike };

class WorkspaceEdit {
  public readonly ops: EditOp[] = [];

  replace(uri: UriLike, range: Range, text: string): void {
    this.ops.push({ kind: 'replace', uri, range, text });
  }

  insert(uri: UriLike, position: Position, text: string): void {
    this.ops.push({ kind: 'insert', uri, position, text });
  }

  createFile(uri: UriLike, options?: { overwrite?: boolean }): void {
    this.ops.push({ kind: 'createFile', uri, overwrite: !!options?.overwrite });
  }

  deleteFile(uri: UriLike): void {
    this.ops.push({ kind: 'deleteFile', uri });
  }
}

function createUri(filePath: string): UriLike {
  return {
    fsPath: filePath,
    path: filePath,
    toString: () => filePath,
  };
}

function normalizeWorkspaceRoot(root: string): string {
  return path.resolve(root);
}

function lineAt(content: string, line: number): { text: string } {
  const lines = content.split('\n');
  return { text: lines[Math.max(0, Math.min(line, Math.max(0, lines.length - 1)))] || '' };
}

async function listAllFilesRecursive(root: string): Promise<UriLike[]> {
  const out: UriLike[] = [];
  const skipDirs = new Set(['.git', 'node_modules', '.gently', 'dist', 'out', 'coverage']);

  async function walk(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        out.push(createUri(fullPath));
      }
    }
  }

  await walk(root);
  return out;
}

function applyTextRange(content: string, range: Range, newText: string): string {
  const lines = content.split('\n');
  const startLine = Math.max(0, Math.min(range.startLine, lines.length));
  const endLine = Math.max(startLine, Math.min(range.endLine, Math.max(0, lines.length - 1)));
  const before = lines.slice(0, startLine).join('\n');
  const after = lines.slice(endLine + 1).join('\n');
  return [before, newText, after].filter((x) => x.length > 0).join('\n');
}

export function createVscodeShim(workspaceRootInput: string): any {
  const workspaceRoot = normalizeWorkspaceRoot(workspaceRootInput);
  const makeDisposable = () => ({ dispose: () => {} });
  const makeEvent = () => (_listener: (...args: any[]) => any) => makeDisposable();

  const workspace: any = {
    workspaceFolders: [{ uri: createUri(workspaceRoot) }],
    textDocuments: [] as any[],
    asRelativePath: (input: any) => {
      const target = typeof input === 'string' ? input : input?.fsPath || input?.path || '';
      return path.relative(workspaceRoot, target).replace(/\\/g, '/');
    },
    fs: {
      stat: async (uri: UriLike) => fs.promises.stat(uri.fsPath),
      readFile: async (uri: UriLike) => fs.promises.readFile(uri.fsPath),
      writeFile: async (uri: UriLike, data: Uint8Array | Buffer) => {
        await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
        await fs.promises.writeFile(uri.fsPath, data);
      },
      createDirectory: async (uri: UriLike) => {
        await fs.promises.mkdir(uri.fsPath, { recursive: true });
      },
      delete: async (uri: UriLike) => {
        await fs.promises.rm(uri.fsPath, { recursive: true, force: true });
      },
    },
    findFiles: async (_pattern: string, _exclude?: string) => {
      return listAllFilesRecursive(workspaceRoot);
    },
    createFileSystemWatcher: (_pattern: any) => ({
      onDidChange: makeEvent(),
      onDidCreate: makeEvent(),
      onDidDelete: makeEvent(),
      dispose: () => {},
    }),
    onDidChangeConfiguration: makeEvent(),
    openTextDocument: async (uri: UriLike) => {
      const text = await fs.promises.readFile(uri.fsPath, 'utf8');
      const doc: any = {
        uri,
        getText: () => text,
        lineCount: text.split('\n').length,
        lineAt: (line: number) => lineAt(text, line),
        save: async () => true,
      };
      return doc;
    },
    applyEdit: async (edit: WorkspaceEdit) => {
      for (const op of edit.ops) {
        if (op.kind === 'createFile') {
          if (!op.overwrite && fs.existsSync(op.uri.fsPath)) {
            throw new Error(`File already exists: ${op.uri.fsPath}`);
          }
          await fs.promises.mkdir(path.dirname(op.uri.fsPath), { recursive: true });
          await fs.promises.writeFile(op.uri.fsPath, '');
        } else if (op.kind === 'deleteFile') {
          await fs.promises.rm(op.uri.fsPath, { recursive: true, force: true });
        } else if (op.kind === 'insert') {
          const original = fs.existsSync(op.uri.fsPath) ? await fs.promises.readFile(op.uri.fsPath, 'utf8') : '';
          const lines = original.split('\n');
          const line = Math.max(0, Math.min(op.position.line, lines.length));
          lines.splice(line, 0, op.text);
          await fs.promises.writeFile(op.uri.fsPath, lines.join('\n'), 'utf8');
        } else if (op.kind === 'replace') {
          const original = fs.existsSync(op.uri.fsPath) ? await fs.promises.readFile(op.uri.fsPath, 'utf8') : '';
          const updated = applyTextRange(original, op.range, op.text);
          await fs.promises.writeFile(op.uri.fsPath, updated, 'utf8');
        }
      }
      return true;
    },
  };

  function createOutputChannel(_name: string) {
    let disposed = false;
    return {
      append: (_value: string) => {
        if (disposed) return;
      },
      appendLine: (_value: string) => {
        if (disposed) return;
      },
      clear: () => {
        if (disposed) return;
      },
      show: () => {
        if (disposed) return;
      },
      hide: () => {
        if (disposed) return;
      },
      dispose: () => {
        disposed = true;
      },
    };
  }

  const window: any = {
    activeTextEditor: undefined,
    withProgress: async (_options: any, task: (progress: any) => Promise<any>) => {
      return task({ report: () => {} });
    },
    createOutputChannel,
    showInformationMessage: async (_message: string, ..._items: string[]) => undefined,
    showWarningMessage: async (_message: string, ..._items: string[]) => undefined,
    showErrorMessage: async (_message: string, ..._items: string[]) => undefined,
    createWebviewPanel: () => ({
      webview: { html: '' },
      reveal: () => {},
      dispose: () => {},
      onDidDispose: () => ({ dispose: () => {} }),
    }),
    registerWebviewViewProvider: () => ({ dispose: () => {} }),
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      color: undefined,
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }),
    onDidChangeActiveTextEditor: makeEvent(),
  };

  const commands: any = {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: async () => undefined,
  };

  const vscodeObj: any = {
    workspace,
    window,
    commands,
    Uri: {
      file: (p: string) => createUri(path.resolve(p)),
      joinPath: (base: any, ...paths: string[]) => {
        const basePath = base?.fsPath || base?.path || String(base || workspaceRoot);
        return createUri(path.join(basePath, ...paths));
      },
    },
    RelativePattern: class {
      base: string;
      pattern: string;
      constructor(base: string, pattern: string) {
        this.base = base;
        this.pattern = pattern;
      }
    },
    WorkspaceEdit,
    Range,
    Position,
    ThemeColor: class {
      id: string;
      constructor(id: string) {
        this.id = id;
      }
    },
    StatusBarAlignment: { Right: 2, Left: 1 },
    Selection: class {
      start: any;
      end: any;
      constructor(start: any, end: any) {
        this.start = start;
        this.end = end;
      }
    },
    TextEditorRevealType: { InCenter: 0 },
    Disposable: { from: (..._d: any[]) => ({ dispose: () => {} }) },
    ProgressLocation: { Notification: 0 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    extensions: { getExtension: () => undefined },
  };

  return new Proxy(vscodeObj, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      return (..._args: any[]) => undefined;
    },
  });
}
