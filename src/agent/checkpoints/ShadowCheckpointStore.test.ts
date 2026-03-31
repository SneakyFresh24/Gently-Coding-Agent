import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ShadowCheckpointStore } from './ShadowCheckpointStore';
import { SerializedCheckpoint } from './types';

vi.mock('vscode', () => ({}));

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createMockContext(storagePath: string) {
  const state = new Map<string, any>();
  return {
    globalStorageUri: { fsPath: storagePath },
    globalState: {
      get: (key: string, fallback: any) => (state.has(key) ? state.get(key) : fallback),
      update: async (key: string, value: any) => {
        state.set(key, value);
      }
    }
  } as any;
}

describe('ShadowCheckpointStore', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('creates checkpoints, restores files, and computes diff set', async () => {
    const workspace = await makeTempDir('gently-workspace-');
    const storage = await makeTempDir('gently-storage-');
    tempRoots.push(workspace, storage);

    const filePath = path.join(workspace, 'a.txt');
    await fs.writeFile(filePath, 'one\n', 'utf8');

    const store = new ShadowCheckpointStore(createMockContext(storage), workspace);
    const first = await store.createCheckpoint({
      messageId: 'm1',
      sessionId: 's1',
      checkpointNumber: 1,
      description: 'first checkpoint',
      metadata: { filesChanged: 0, totalSize: 0 }
    });

    await fs.writeFile(filePath, 'two\n', 'utf8');
    const second = await store.createCheckpoint({
      messageId: 'm2',
      sessionId: 's1',
      checkpointNumber: 2,
      description: 'second checkpoint',
      metadata: { filesChanged: 0, totalSize: 0 }
    });

    const checkpoints = await store.listCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(checkpoints[0].checkpointNumber).toBeGreaterThanOrEqual(1);

    const diff = await store.getDiffSet(first.id, second.id);
    expect(diff.files.some((f) => f.relativePath === 'a.txt')).toBe(true);

    const restore = await store.restoreCheckpoint(first.id, { mode: 'files' });
    expect(restore.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf8');
    expect(content.replace(/\r\n/g, '\n')).toBe('one\n');
  });

  it('supports one-time legacy migration mapping', async () => {
    const workspace = await makeTempDir('gently-workspace-');
    const storage = await makeTempDir('gently-storage-');
    tempRoots.push(workspace, storage);

    await fs.writeFile(path.join(workspace, 'x.txt'), 'x', 'utf8');

    const store = new ShadowCheckpointStore(createMockContext(storage), workspace);
    const legacy: SerializedCheckpoint[] = [
      {
        id: 'legacy-1',
        messageId: 'msg-1',
        checkpointNumber: 1,
        timestamp: Date.now() - 1000,
        description: 'legacy one',
        files: [],
        metadata: { filesChanged: 0, totalSize: 0 }
      },
      {
        id: 'legacy-2',
        messageId: 'msg-2',
        checkpointNumber: 2,
        timestamp: Date.now(),
        description: 'legacy two',
        files: [],
        metadata: { filesChanged: 0, totalSize: 0 }
      }
    ];

    const mapping = await store.migrateLegacyCheckpoints(legacy);
    expect(Object.keys(mapping)).toContain('legacy-1');
    expect(Object.keys(mapping)).toContain('legacy-2');

    const cp = await store.getCheckpoint('legacy-1');
    expect(cp?.legacyId).toBe('legacy-1');
  });
});
