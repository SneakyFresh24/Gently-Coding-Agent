import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Ensures a directory exists, creating it recursively if necessary.
 */
export async function ensureDir(dir: string): Promise<void> {
  if (!dir) return;
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Safely writes a file by ensuring its parent directory exists first.
 */
export async function safeWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, data, 'utf8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFileAsync(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

export async function copyFileAsync(src: string, dest: string): Promise<void> {
  await fs.copyFile(src, dest);
}
