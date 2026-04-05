import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTools } from './FileTools';
import { ToolRegistry } from './ToolRegistry';

function createHarness() {
  const fileOps = {
    writeFile: vi.fn().mockResolvedValue(undefined),
    getLanguageFromPath: vi.fn().mockReturnValue('typescript'),
    readFile: vi.fn(),
    listFiles: vi.fn()
  } as any;

  const indexer = {
    findRelevantFilesHybrid: vi.fn().mockResolvedValue([])
  } as any;

  const contextManager = {
    trackFileAccess: vi.fn(),
    markFileRead: vi.fn()
  } as any;

  const regexSearchService = {
    search: vi.fn().mockResolvedValue({ success: true, matches: [] })
  } as any;

  const registry = new ToolRegistry();
  const tools = new FileTools(fileOps, indexer, contextManager, regexSearchService);
  tools.registerTools(registry);
  const writeChunkTool = registry.get('write_file_chunk');
  if (!writeChunkTool) {
    throw new Error('write_file_chunk tool not registered');
  }

  return {
    fileOps,
    tools,
    writeChunk: (params: Record<string, unknown>) => writeChunkTool.execute(params)
  };
}

describe('FileTools chunked write sessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires stale chunk sessions after TTL and rejects late chunks', async () => {
    const { writeChunk } = createHarness();

    const first = await writeChunk({
      path: 'src/a.ts',
      writeSessionId: 'session_a',
      chunkIndex: 0,
      chunkCount: 2,
      chunkContent: 'export const a = ',
    });
    expect(first.success).toBe(true);
    expect(first.pending).toBe(true);

    await vi.advanceTimersByTimeAsync((10 * 60 * 1000) + 1);

    await writeChunk({
      path: 'src/b.ts',
      writeSessionId: 'session_b',
      chunkIndex: 0,
      chunkCount: 2,
      chunkContent: 'export const b = ',
    });

    const lateChunk = await writeChunk({
      path: 'src/a.ts',
      writeSessionId: 'session_a',
      chunkIndex: 1,
      chunkCount: 2,
      chunkContent: '1;'
    });

    expect(lateChunk.success).toBe(false);
    expect(String(lateChunk.message || '')).toContain('Unknown or expired writeSessionId');
  });

  it('enforces max pending chunk session cap and evicts oldest sessions', async () => {
    const { writeChunk, fileOps } = createHarness();

    for (let i = 0; i <= 200; i++) {
      const res = await writeChunk({
        path: `src/file_${i}.ts`,
        writeSessionId: `session_${i}`,
        chunkIndex: 0,
        chunkCount: 2,
        chunkContent: `export const value${i} = `
      });
      expect(res.success).toBe(true);
    }

    const evicted = await writeChunk({
      path: 'src/file_0.ts',
      writeSessionId: 'session_0',
      chunkIndex: 1,
      chunkCount: 2,
      chunkContent: '0;'
    });
    expect(evicted.success).toBe(false);
    expect(String(evicted.message || '')).toContain('Unknown or expired writeSessionId');

    const active = await writeChunk({
      path: 'src/file_200.ts',
      writeSessionId: 'session_200',
      chunkIndex: 1,
      chunkCount: 2,
      chunkContent: '200;'
    });
    expect(active.success).toBe(true);
    expect(fileOps.writeFile).toHaveBeenCalledWith(
      'src/file_200.ts',
      'export const value200 = 200;'
    );
  });
});
