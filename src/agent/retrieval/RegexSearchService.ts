import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch';
import { FileOperations } from '../fileOperations';
import { RetrievalConfig } from './RetrievalConfig';
import { RegexPatternAnalyzer } from './RegexPatternAnalyzer';
import { RegexTrigramIndex, IndexedFileRecord } from './RegexTrigramIndex';

type Re2LikeCtor = new (pattern: string, flags?: string) => RegExp;

export interface RegexSearchParams {
  pattern: string;
  path_glob?: string;
  flags?: string;
  case_sensitive?: boolean;
  multiline?: boolean;
  max_results?: number;
  context_lines?: number;
}

export interface RegexMatch {
  file_path: string;
  line: number;
  column: number;
  match: string;
  excerpt: string;
}

export interface RegexSearchResponse {
  success: boolean;
  matches: RegexMatch[];
  metadata: {
    source: 'index' | 'fallback';
    engineUsed: 're2' | 'rg';
    fallbackReason?: string;
    candidateCount: number;
    verifiedFiles: number;
    timings: Record<string, number>;
    indexState: 'ready' | 'building' | 'empty';
  };
}

interface FileHashEntry {
  hash: string;
  mtime: number;
  size: number;
}

interface RegexConfig {
  enabled: boolean;
  queryTimeoutMs: number;
  maxCandidates: number;
  maxVerifiedFiles: number;
  maxMatches: number;
  indexDir: string;
  metadataFile: string;
  hashFile: string;
}

const CODE_EXTENSIONS = new Set<string>([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.py', '.pyw', '.java', '.kt', '.scala',
  '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.swift',
  '.json', '.xml', '.yaml', '.yml', '.md', '.txt',
  '.sql', '.sh', '.bat', '.ps1'
]);

export class RegexSearchService {
  private readonly analyzer = new RegexPatternAnalyzer();
  private readonly trigramIndex: RegexTrigramIndex;
  private readonly config: RegexConfig;
  private readonly workspaceRoot: string;
  private readonly metadataPath: string;
  private readonly hashPath: string;
  private hashIndex: Record<string, FileHashEntry> = {};
  private re2Ctor: Re2LikeCtor | null = null;
  private re2LoadError: string | null = null;
  private isBuilding = false;
  private buildPromise: Promise<void> | null = null;
  private hasIndexedOnce = false;

  constructor(
    private readonly fileOps: FileOperations
  ) {
    this.workspaceRoot = this.fileOps.getWorkspaceRoot();
    const cfg = RetrievalConfig.regexSearch;
    const indexDir = path.join(this.workspaceRoot, cfg.indexDir);
    this.config = {
      enabled: cfg.enabled,
      queryTimeoutMs: cfg.queryTimeoutMs,
      maxCandidates: cfg.maxCandidates,
      maxVerifiedFiles: cfg.maxVerifiedFiles,
      maxMatches: cfg.maxMatches,
      indexDir,
      metadataFile: cfg.metadataFile,
      hashFile: cfg.hashFile
    };
    this.metadataPath = path.join(indexDir, this.config.metadataFile);
    this.hashPath = path.join(indexDir, this.config.hashFile);
    this.trigramIndex = new RegexTrigramIndex(indexDir);
    this.loadRe2();
  }

  async search(params: RegexSearchParams): Promise<RegexSearchResponse> {
    const start = Date.now();
    const timings: Record<string, number> = {};

    if (!this.config.enabled) {
      return this.fallbackWithRg(params, 'regex_search_disabled', timings, start);
    }

    if (!params.pattern || params.pattern.trim() === '') {
      return {
        success: false,
        matches: [],
        metadata: {
          source: 'fallback',
          engineUsed: 'rg',
          fallbackReason: 'empty_pattern',
          candidateCount: 0,
          verifiedFiles: 0,
          timings: { totalMs: Date.now() - start },
          indexState: 'empty'
        }
      };
    }

    const analysis = this.analyzer.analyzePattern(params.pattern, params);
    if (analysis.fallbackReason) {
      return this.fallbackWithRg(params, analysis.fallbackReason, timings, start);
    }

    await this.ensureIndexFilesLoaded();
    this.scheduleBackgroundBuild();

    if (!this.hasIndexedOnce) {
      return this.fallbackWithRg(params, 'index_not_ready', timings, start);
    }

    const candidateStart = Date.now();
    const candidates = await this.trigramIndex.selectCandidates(
      analysis.trigrams,
      this.config.maxCandidates
    );
    timings.candidateMs = Date.now() - candidateStart;

    if (candidates.length === 0) {
      timings.totalMs = Date.now() - start;
      return {
        success: true,
        matches: [],
        metadata: {
          source: 'index',
          engineUsed: 're2',
          candidateCount: 0,
          verifiedFiles: 0,
          timings,
          indexState: this.isBuilding ? 'building' : 'ready'
        }
      };
    }

    if (!this.re2Ctor) {
      return this.fallbackWithRg(params, this.re2LoadError || 're2_unavailable', timings, start);
    }

    const verifyStart = Date.now();
    const matches = await this.verifyCandidatesWithRe2(
      candidates,
      params,
      analysis.normalizedFlags,
      start
    );
    timings.verifyMs = Date.now() - verifyStart;
    timings.totalMs = Date.now() - start;

    return {
      success: true,
      matches,
      metadata: {
        source: 'index',
        engineUsed: 're2',
        candidateCount: candidates.length,
        verifiedFiles: Math.min(candidates.length, this.config.maxVerifiedFiles),
        timings,
        indexState: this.isBuilding ? 'building' : 'ready'
      }
    };
  }

  private async verifyCandidatesWithRe2(
    candidateFiles: string[],
    params: RegexSearchParams,
    normalizedFlags: string,
    overallStart: number
  ): Promise<RegexMatch[]> {
    if (!this.re2Ctor) return [];

    const flags = this.buildRegexFlags(normalizedFlags);
    const re2 = new this.re2Ctor(params.pattern, flags);
    const matches: RegexMatch[] = [];
    const maxResults = params.max_results || this.config.maxMatches;

    for (let i = 0; i < candidateFiles.length; i++) {
      if (i >= this.config.maxVerifiedFiles) break;
      if (Date.now() - overallStart > this.config.queryTimeoutMs) break;

      const relativePath = candidateFiles[i];
      if (params.path_glob && !this.matchesPathGlob(relativePath, params.path_glob)) {
        continue;
      }

      const absolutePath = this.toAbsolutePath(relativePath);
      let content = '';
      try {
        content = await fs.readFile(absolutePath, 'utf8');
      } catch {
        continue;
      }

      re2.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re2.exec(content)) !== null) {
        const startIndex = match.index ?? 0;
        const loc = this.getLineAndColumn(content, startIndex);
        matches.push({
          file_path: relativePath,
          line: loc.line,
          column: loc.column,
          match: match[0] || '',
          excerpt: this.getExcerpt(content, startIndex, params.context_lines || 0)
        });

        if (matches.length >= maxResults) {
          return matches;
        }

        if (Date.now() - overallStart > this.config.queryTimeoutMs) {
          return matches;
        }

        if (match[0] === '') {
          re2.lastIndex += 1;
        }
      }
    }

    return matches;
  }

  private async fallbackWithRg(
    params: RegexSearchParams,
    fallbackReason: string,
    timings: Record<string, number>,
    overallStart: number
  ): Promise<RegexSearchResponse> {
    const fallbackStart = Date.now();
    const matches = await this.searchWithRipgrep(params, overallStart);
    timings.fallbackMs = Date.now() - fallbackStart;
    timings.totalMs = Date.now() - overallStart;

    return {
      success: true,
      matches,
      metadata: {
        source: 'fallback',
        engineUsed: 'rg',
        fallbackReason,
        candidateCount: 0,
        verifiedFiles: 0,
        timings,
        indexState: this.hasIndexedOnce ? (this.isBuilding ? 'building' : 'ready') : 'empty'
      }
    };
  }

  private async searchWithRipgrep(params: RegexSearchParams, overallStart: number): Promise<RegexMatch[]> {
    return new Promise((resolve) => {
      const args: string[] = ['--json', '--line-number', '--column', '--color', 'never'];
      if (params.multiline) args.push('-U');
      if (params.case_sensitive === false || (params.flags || '').includes('i')) {
        args.push('-i');
      }
      if (params.path_glob) {
        args.push('--glob', params.path_glob);
      }
      args.push(params.pattern, '.');

      const proc = spawn('rg', args, { cwd: this.workspaceRoot });
      const matches: RegexMatch[] = [];
      let buffer = '';
      const maxResults = params.max_results || this.config.maxMatches;

      const finalize = () => resolve(matches.slice(0, maxResults));

      proc.stdout.on('data', (chunk) => {
        if (Date.now() - overallStart > this.config.queryTimeoutMs) {
          proc.kill();
          return;
        }

        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type !== 'match') continue;
            const data = parsed.data;
            const sub = data.submatches?.[0];
            matches.push({
              file_path: data.path?.text || '',
              line: Number(data.line_number || 1),
              column: Number((sub?.start ?? 0) + 1),
              match: String(sub?.match?.text || ''),
              excerpt: String(data.lines?.text || '').trimEnd()
            });
            if (matches.length >= maxResults) {
              proc.kill();
              return;
            }
          } catch {
            // Ignore malformed lines
          }
        }
      });

      proc.on('error', () => resolve([]));
      proc.on('close', finalize);
    });
  }

  private async ensureIndexFilesLoaded(): Promise<void> {
    await fs.mkdir(this.config.indexDir, { recursive: true });
    this.hashIndex = await this.readHashFile();
    this.hasIndexedOnce = await this.hasMetadata();
  }

  private scheduleBackgroundBuild(): void {
    if (this.isBuilding) return;
    this.isBuilding = true;
    this.buildPromise = this.rebuildIncremental()
      .catch((error) => {
        console.error('[RegexSearchService] Background build failed:', error);
      })
      .finally(() => {
        this.isBuilding = false;
      });
  }

  private async rebuildIncremental(): Promise<void> {
    const files = await this.listIndexableFiles();
    const currentSet = new Set(files);
    const existing = new Set(Object.keys(this.hashIndex));
    const now = Date.now();

    for (const relPath of files) {
      const absolute = this.toAbsolutePath(relPath);
      const stat = await fs.stat(absolute);
      const mtime = Math.floor(stat.mtimeMs);
      const size = stat.size;
      const prev = this.hashIndex[relPath];
      if (prev && prev.mtime === mtime && prev.size === size) {
        continue;
      }

      const content = await fs.readFile(absolute, 'utf8');
      const hash = createHash('sha1').update(content).digest('hex');
      if (prev && prev.hash === hash) {
        this.hashIndex[relPath] = { hash, mtime, size };
        continue;
      }

      const trigrams = this.extractFileTrigrams(content);
      const fileRecord: IndexedFileRecord = { path: relPath, hash, mtime, size };
      await this.trigramIndex.upsertFile(fileRecord, trigrams);
      this.hashIndex[relPath] = { hash, mtime, size };
    }

    for (const stalePath of existing) {
      if (currentSet.has(stalePath)) continue;
      await this.trigramIndex.removeFile(stalePath);
      delete this.hashIndex[stalePath];
    }

    await this.trigramIndex.persist();
    await this.writeHashFile();
    await this.writeMetadata({ lastBuildAt: now, fileCount: files.length, version: 1 });
    this.hasIndexedOnce = true;
  }

  private extractFileTrigrams(content: string): Map<string, number> {
    const normalized = content.toLowerCase();
    const counts = new Map<string, number>();
    if (normalized.length < 3) return counts;

    for (let i = 0; i <= normalized.length - 3; i++) {
      const tri = normalized.slice(i, i + 3);
      if (/\s{3}/.test(tri)) continue;
      counts.set(tri, (counts.get(tri) || 0) + 1);
    }

    return counts;
  }

  private async listIndexableFiles(): Promise<string[]> {
    const allFiles = await this.fileOps.listFiles('**/*', '{**/node_modules/**,**/out/**,**/dist/**,**/build/**,**/.git/**,**/.gently/**}');
    return allFiles.filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return CODE_EXTENSIONS.has(ext);
    });
  }

  private toAbsolutePath(relativeOrAbsolute: string): string {
    return path.isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : path.join(this.workspaceRoot, relativeOrAbsolute);
  }

  private getLineAndColumn(content: string, index: number): { line: number; column: number } {
    const prefix = content.slice(0, index);
    const lines = prefix.split('\n');
    return {
      line: lines.length,
      column: (lines[lines.length - 1]?.length || 0) + 1
    };
  }

  private getExcerpt(content: string, index: number, contextLines: number): string {
    const lines = content.split('\n');
    const loc = this.getLineAndColumn(content, index);
    const from = Math.max(0, loc.line - 1 - contextLines);
    const to = Math.min(lines.length - 1, loc.line - 1 + contextLines);
    return lines.slice(from, to + 1).join('\n');
  }

  private matchesPathGlob(filePath: string, globPattern: string): boolean {
    try {
      return minimatch(filePath, globPattern, { dot: true });
    } catch {
      return true;
    }
  }

  private buildRegexFlags(baseFlags: string): string {
    const flags = new Set(baseFlags.split('').filter(Boolean));
    flags.add('g');
    return Array.from(flags).join('');
  }

  private loadRe2(): void {
    try {
      const runtimeRequire = new Function('return require')() as NodeRequire;
      const RE2 = runtimeRequire('re2');
      this.re2Ctor = RE2 as Re2LikeCtor;
      this.re2LoadError = null;
    } catch (error) {
      this.re2Ctor = null;
      this.re2LoadError = error instanceof Error ? error.message : String(error);
      console.warn('[RegexSearchService] re2 unavailable, fallback to rg-only mode');
    }
  }

  private async hasMetadata(): Promise<boolean> {
    try {
      await fs.access(this.metadataPath);
      return true;
    } catch {
      return false;
    }
  }

  private async readHashFile(): Promise<Record<string, FileHashEntry>> {
    try {
      const raw = await fs.readFile(this.hashPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, FileHashEntry>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeHashFile(): Promise<void> {
    await fs.writeFile(this.hashPath, JSON.stringify(this.hashIndex, null, 2), 'utf8');
  }

  private async writeMetadata(metadata: Record<string, unknown>): Promise<void> {
    await fs.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  }
}
