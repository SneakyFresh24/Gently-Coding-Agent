import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface IndexedFileRecord {
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

export class RegexTrigramIndex {
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private dirty = false;

  constructor(
    private readonly indexDir: string,
    private readonly dbFileName: string = 'trigrams.db'
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await fs.mkdir(this.indexDir, { recursive: true });
      const wasmPath = path.join(__dirname, 'sql-wasm.wasm');

      this.SQL = await initSqlJs({
        locateFile: (file: string) => (file === 'sql-wasm.wasm' ? wasmPath : path.join(__dirname, file))
      });

      const dbPath = this.getDbPath();
      const exists = await this.fileExists(dbPath);
      if (exists) {
        const content = await fs.readFile(dbPath);
        this.db = new this.SQL.Database(new Uint8Array(content));
      } else {
        this.db = new this.SQL.Database();
      }

      this.ensureSchema();
      this.initialized = true;
    })();

    return this.initPromise;
  }

  async upsertFile(record: IndexedFileRecord, trigrams: Map<string, number>): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('RegexTrigramIndex not initialized');

    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run(
        `INSERT INTO files (path, hash, mtime, size, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash,
           mtime = excluded.mtime,
           size = excluded.size,
           updated_at = excluded.updated_at`,
        [record.path, record.hash, record.mtime, record.size, Date.now()]
      );

      const fileId = this.getFileIdByPath(record.path);
      if (!fileId) {
        throw new Error(`Failed to resolve file id for ${record.path}`);
      }

      this.db.run('DELETE FROM postings WHERE file_id = ?', [fileId]);
      const stmt = this.db.prepare(
        'INSERT INTO postings (trigram, file_id, occurrences) VALUES (?, ?, ?)'
      );
      for (const [trigram, count] of trigrams.entries()) {
        stmt.run([trigram, fileId, count]);
      }
      stmt.free();

      this.db.run('COMMIT');
      this.dirty = true;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const fileId = this.getFileIdByPath(filePath);
    if (!fileId) return;

    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run('DELETE FROM postings WHERE file_id = ?', [fileId]);
      this.db.run('DELETE FROM files WHERE file_id = ?', [fileId]);
      this.db.run('COMMIT');
      this.dirty = true;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  async selectCandidates(trigrams: string[], maxCandidates: number): Promise<string[]> {
    await this.initialize();
    if (!this.db || trigrams.length === 0) return [];

    const placeholders = trigrams.map(() => '?').join(', ');
    const required = trigrams.length;
    const sql = `
      SELECT f.path AS path
      FROM postings p
      JOIN files f ON f.file_id = p.file_id
      WHERE p.trigram IN (${placeholders})
      GROUP BY p.file_id
      HAVING COUNT(DISTINCT p.trigram) >= ?
      ORDER BY SUM(p.occurrences) DESC
      LIMIT ?
    `;
    const result = this.db.exec(sql, [...trigrams, required, maxCandidates]);
    if (result.length === 0 || result[0].values.length === 0) return [];
    return result[0].values.map((v) => String(v[0]));
  }

  async listIndexedFiles(): Promise<IndexedFileRecord[]> {
    await this.initialize();
    if (!this.db) return [];

    const res = this.db.exec('SELECT path, hash, mtime, size FROM files');
    if (res.length === 0) return [];

    return res[0].values.map((row) => ({
      path: String(row[0]),
      hash: String(row[1]),
      mtime: Number(row[2]),
      size: Number(row[3])
    }));
  }

  async persist(): Promise<void> {
    await this.initialize();
    if (!this.db || !this.dirty) return;

    const dbPath = this.getDbPath();
    const data = this.db.export();
    await fs.writeFile(dbPath, Buffer.from(data));
    this.dirty = false;
  }

  async close(): Promise<void> {
    await this.persist();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.SQL = null;
    this.initialized = false;
    this.initPromise = null;
  }

  private ensureSchema(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        file_id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS postings (
        trigram TEXT NOT NULL,
        file_id INTEGER NOT NULL,
        occurrences INTEGER NOT NULL,
        PRIMARY KEY (trigram, file_id)
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_postings_trigram ON postings(trigram)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_postings_file ON postings(file_id)');
  }

  private getFileIdByPath(filePath: string): number | null {
    if (!this.db) return null;
    const result = this.db.exec('SELECT file_id FROM files WHERE path = ? LIMIT 1', [filePath]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return Number(result[0].values[0][0]);
  }

  private getDbPath(): string {
    return path.join(this.indexDir, this.dbFileName);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
