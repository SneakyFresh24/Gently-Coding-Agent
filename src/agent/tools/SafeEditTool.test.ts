import { describe, expect, it, vi } from 'vitest';
import { SafeEditTool } from './SafeEditTool';

describe('SafeEditTool', () => {
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
      executeEdit: vi.fn()
    } as any;

    return {
      tool: new SafeEditTool(fileOps, contextManager, editorEngine),
      fileOps,
      contextManager,
      editorEngine
    };
  };

  it('blocks edits if file was not read first', async () => {
    const { tool, contextManager, editorEngine } = createTool();
    contextManager.hasFileBeenRead.mockReturnValue(false);

    const result = await tool.execute({
      file_path: 'src/a.ts',
      new_content: 'x'
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Read-before-edit required');
    expect(editorEngine.executeEdit).not.toHaveBeenCalled();
  });

  it('passes allow_fuzzy flag to editor engine', async () => {
    const { tool, editorEngine } = createTool();
    editorEngine.executeEdit.mockResolvedValue({
      success: true,
      path: 'src/a.ts'
    });

    await tool.execute({
      file_path: 'src/a.ts',
      new_content: 'x',
      allow_fuzzy: true
    });

    expect(editorEngine.executeEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'src/a.ts',
        allowFuzzy: true
      })
    );
  });
});
