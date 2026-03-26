import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/Logger', () => ({
  Logger: {
    getInstance: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}));

import { ApplyBlockEditTool } from './ApplyBlockEditTool';

describe('ApplyBlockEditTool', () => {
  const createTool = () => {
    const fileOps = {
      getWorkspaceRoot: vi.fn(() => 'C:/workspace'),
      readFile: vi.fn(async (path: string) => ({
        path,
        content: 'content',
        language: 'typescript',
        size: 7
      }))
    } as any;

    const contextManager = {
      trackFileAccess: vi.fn(),
      hasFileBeenRead: vi.fn(() => true)
    } as any;

    const editorEngine = {
      applyHunkEditsSafely: vi.fn()
    } as any;

    return {
      tool: new ApplyBlockEditTool(fileOps, contextManager, editorEngine),
      fileOps,
      contextManager,
      editorEngine
    };
  };

  it('supports v1 single-file payload', async () => {
    const { tool, editorEngine, contextManager } = createTool();
    editorEngine.applyHunkEditsSafely.mockResolvedValue({
      success: true,
      appliedCount: 1,
      failedCount: 0,
      appliedHunks: ['hunk-0'],
      failedHunks: []
    });

    const result = await tool.execute({
      file_path: 'src/a.ts',
      edits: [{ old_content: 'a', new_content: 'b', reason: 'test' }]
    });

    expect(result.success).toBe(true);
    expect(editorEngine.applyHunkEditsSafely).toHaveBeenCalledTimes(1);
    expect(editorEngine.applyHunkEditsSafely.mock.calls[0][0].filePath).toBe('src/a.ts');
    expect(contextManager.trackFileAccess).toHaveBeenCalledTimes(1);
  });

  it('supports v2 multi-file payload with per-file results', async () => {
    const { tool, editorEngine, contextManager } = createTool();
    editorEngine.applyHunkEditsSafely
      .mockResolvedValueOnce({
        success: true,
        appliedCount: 1,
        failedCount: 0,
        appliedHunks: ['hunk-0'],
        failedHunks: []
      })
      .mockResolvedValueOnce({
        success: false,
        appliedCount: 0,
        failedCount: 1,
        appliedHunks: [],
        failedHunks: [{ id: 'hunk-0', reason: 'mismatch', suggestedFix: 'update old_content' }]
      });

    const result = await tool.execute({
      file_edits: [
        {
          file_path: 'src/a.ts',
          edits: [{ old_content: 'a', new_content: 'b', reason: 'test-a' }]
        },
        {
          file_path: 'src/b.ts',
          edits: [{ old_content: 'x', new_content: 'y', reason: 'test-b' }]
        }
      ]
    });

    expect(result.fileMode).toBe('multi-file');
    expect(result.filesApplied).toBe(1);
    expect(result.filesFailed).toBe(1);
    expect(result.success).toBe(false);
    expect(result.perFileResults).toHaveLength(2);
    expect(editorEngine.applyHunkEditsSafely).toHaveBeenCalledTimes(2);
    expect(contextManager.trackFileAccess).toHaveBeenCalledTimes(1);
  });

  it('rejects v2 payloads with more than 5 files', async () => {
    const { tool, editorEngine } = createTool();

    const result = await tool.execute({
      file_edits: Array.from({ length: 6 }, (_, idx) => ({
        file_path: `src/f${idx}.ts`,
        edits: [{ old_content: 'a', new_content: 'b', reason: 'bulk' }]
      }))
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Maximum allowed is 5 files');
    expect(editorEngine.applyHunkEditsSafely).not.toHaveBeenCalled();
  });

  it('fails when file was not read before editing', async () => {
    const { tool, contextManager, editorEngine } = createTool();
    contextManager.hasFileBeenRead.mockReturnValue(false);

    const result = await tool.execute({
      file_path: 'src/a.ts',
      edits: [{ old_content: 'a', new_content: 'b', reason: 'test' }]
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Read-before-edit required');
    expect(editorEngine.applyHunkEditsSafely).not.toHaveBeenCalled();
  });
});
