import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(async () => undefined),
    readdir: vi.fn(async () => [] as string[]),
    stat: vi.fn(async () => ({ mtimeMs: Date.now() })),
    unlink: vi.fn(async () => undefined)
  }
}));

vi.mock('../../utils/persistenceUtils', () => ({
  fileExists: vi.fn(async () => true),
  readFileAsync: vi.fn(async () => ''),
  copyFileAsync: vi.fn(async () => undefined),
  safeWriteFile: vi.fn(async () => undefined)
}));

import { EditorEngine } from './EditorEngine';
import { copyFileAsync, readFileAsync, safeWriteFile } from '../../utils/persistenceUtils';
import * as fs from 'fs';

describe('EditorEngine.applyHunkEditsSafely', () => {
  const fileOps = {
    getWorkspaceRoot: vi.fn(() => 'C:/workspace'),
    editFile: vi.fn()
  } as any;

  const astAnalyzer = {
    analyzeFile: vi.fn(async () => [])
  } as any;

  let engine: EditorEngine;

  beforeEach(() => {
    engine = new EditorEngine(fileOps, astAnalyzer);
    vi.clearAllMocks();
    vi.mocked((fs as any).promises.readdir).mockResolvedValue([]);
  });

  it('applies multi-line hunks using real newline splitting', async () => {
    vi.mocked(readFileAsync).mockResolvedValue('a\nb\nc');

    const result = await engine.applyHunkEditsSafely({
      filePath: 'src/a.ts',
      mode: 'best-effort',
      previewOnly: false,
      edits: [
        { id: 'h1', oldContent: 'b\nc', newContent: 'x\ny', reason: 'replace tail' }
      ]
    });

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(safeWriteFile).toHaveBeenCalledWith(expect.any(String), 'a\nx\ny');
  });

  it('rejects ambiguous exact matches (multiple match detection)', async () => {
    vi.mocked(readFileAsync).mockResolvedValue('foo\nbar\nx\nfoo\nbar');

    const result = await engine.applyHunkEditsSafely({
      filePath: 'src/a.ts',
      mode: 'best-effort',
      previewOnly: false,
      edits: [
        { id: 'h1', oldContent: 'foo\nbar', newContent: 'z', reason: 'ambiguous' }
      ]
    });

    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.failedHunks[0].reason).toContain('ambiguous');
    expect(result.failedHunks[0].matchCount).toBeGreaterThan(1);
    expect(safeWriteFile).not.toHaveBeenCalled();
  });

  it('requires unique context-anchored matches', async () => {
    vi.mocked(readFileAsync).mockResolvedValue('startA\nfoo\nbar\nmid\nstartB\nfoo\nbar\nend');

    const result = await engine.applyHunkEditsSafely({
      filePath: 'src/a.ts',
      mode: 'best-effort',
      previewOnly: false,
      edits: [
        {
          id: 'h1',
          oldContent: 'foo\nbar',
          newContent: 'only-once',
          contextBefore: 'startB',
          reason: 'disambiguate with context'
        }
      ]
    });

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(safeWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      'startA\nfoo\nbar\nmid\nstartB\nonly-once\nend'
    );
  });

  it('detects out-of-order hunks during forward validation', async () => {
    vi.mocked(readFileAsync).mockResolvedValue('A\nX\nB\nY');

    const result = await engine.applyHunkEditsSafely({
      filePath: 'src/a.ts',
      mode: 'best-effort',
      previewOnly: false,
      edits: [
        { id: 'h1', oldContent: 'B', newContent: 'B2', reason: 'later first' },
        { id: 'h2', oldContent: 'X', newContent: 'X2', reason: 'earlier second' }
      ]
    });

    expect(result.appliedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failedHunks[0].reason).toContain('Out-of-order');
  });

  it('stores managed backups under .gently/backups and does not create workspace .bak files', async () => {
    vi.mocked(readFileAsync).mockResolvedValue('line 1\nline 2');

    const result = await engine.executeEdit({
      filePath: 'src/demo.ts',
      anchorLine: 'line 1',
      newContent: 'updated line 1'
    });

    expect(result.success).toBe(true);
    expect(result.backupPath).toContain('.gently/backups/src/demo.ts.bak-');
    expect(copyFileAsync).toHaveBeenCalledTimes(1);
    const backupTarget = String(vi.mocked(copyFileAsync).mock.calls[0]?.[1] || '');
    expect(backupTarget).toContain('.gently\\backups');
    expect(backupTarget.replace(/\\/g, '/')).toMatch(/^C:\/workspace\/\.gently\/backups\//);
  });
});
