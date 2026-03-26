import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/persistenceUtils', () => ({
  fileExists: vi.fn(async () => true),
  readFileAsync: vi.fn(async () => ''),
  copyFileAsync: vi.fn(async () => undefined),
  safeWriteFile: vi.fn(async () => undefined)
}));

import { EditorEngine } from './EditorEngine';
import { readFileAsync, safeWriteFile } from '../../utils/persistenceUtils';

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
});
