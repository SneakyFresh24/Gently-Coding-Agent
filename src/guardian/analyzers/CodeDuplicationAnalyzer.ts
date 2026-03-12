/**
 * Code Duplication Analyzer – NEUE, performante Version (2026)
 * Verwendet Hashing + Block-basiertes Matching statt naiver String-Vergleiche
 */

import { BaseAnalyzer } from './BaseAnalyzer';
import { GuardianIssue, GuardianIssueType, GuardianSeverity, GuardianSource, GuardianAnalysisContext, SuggestionType, SuggestionAction, EffortLevel } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RelationshipGraph } from '../../agent/graph/RelationshipGraph';

interface CodeBlock {
  hash: string;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export class CodeDuplicationAnalyzer extends BaseAnalyzer {
  private readonly MIN_BLOCK_SIZE = 60;     // Zeichen
  private readonly MIN_DUPLICATES = 2;

  // Akzeptiert Graph für Kompatibilität (selbst wenn er aktuell nicht gebraucht wird)
  constructor(private relationshipGraph: RelationshipGraph) {
    super('code-duplication', 'Code Duplication Analyzer', 'Erkennt duplizierten Code effizient und skalierbar');
  }

  async analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];
    const blocks: CodeBlock[] = [];

    try {
      const files = this.getFilesToAnalyze(context);

      // Phase 1: Blöcke extrahieren + hashen
      for (const filePath of files) {
        try {
          const content = context.getFileContent ? context.getFileContent(filePath) : fs.readFileSync(filePath, 'utf-8');
          const fileBlocks = this.extractBlocks(content, filePath);
          blocks.push(...fileBlocks);
        } catch (e) {
          console.warn(`[CodeDuplication] Konnte ${filePath} nicht lesen`);
        }
      }

      // Phase 2: Duplikate finden (Hash-Map)
      const duplicates = this.findDuplicates(blocks);

      // Phase 3: Issues erzeugen
      for (const [hash, group] of duplicates) {
        if (group.length >= this.MIN_DUPLICATES) {
          issues.push(this.createDuplicationIssue(group));
        }
      }

      console.log(`[CodeDuplicationAnalyzer] ${issues.length} Duplikat-Gruppen gefunden`);
    } catch (error) {
      console.error('[CodeDuplicationAnalyzer] Fehler:', error);
    }

    return issues;
  }

  private getFilesToAnalyze(context: GuardianAnalysisContext): string[] {
    if (context.changedFiles && context.changedFiles.length > 0) {
      return context.changedFiles.filter(f => this.isRelevantFile(f));
    }

    // Fallback: nur relevante Dateien (kein Full-Scan mehr!)
    const files: string[] = [];
    this.collectRelevantFiles(context.workspaceRoot, files);
    return files;
  }

  private collectRelevantFiles(dir: string, files: string[]) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Ignorieren versteckter Dateien und .gently/.git
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name)) {
          this.collectRelevantFiles(fullPath, files);
        } else if (this.isRelevantFile(fullPath)) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      console.error(`[CodeDuplicationAnalyzer] Fehler beim Lesen von ${dir}:`, err);
    }
  }

  private shouldSkipDirectory(name: string): boolean {
    return ['node_modules', 'dist', 'build', '.git', 'coverage', 'out', '.next', '.gently', 'tmp'].includes(name);
  }

  private isRelevantFile(filePath: string): boolean {
    return /\.(ts|js|tsx|jsx)$/.test(filePath);
  }

  private extractBlocks(content: string, filePath: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const lines = content.split('\n');
    let current = '';

    for (let i = 0; i < lines.length; i++) {
      current += lines[i] + '\n';

      // Block abschließen, wenn Zeilenlimit oder Leerzeile erreicht wird + Mindestlänge erfüllt ist
      if (current.length >= this.MIN_BLOCK_SIZE && (i % 8 === 0 || lines[i].trim() === '')) {
        const normalized = current.replace(/\s+/g, ' ').trim();
        const hash = crypto.createHash('md5').update(normalized).digest('hex');

        blocks.push({
          hash,
          filePath,
          startLine: i - (current.split('\n').length - 1) + 2,
          endLine: i + 1,
          snippet: normalized.slice(0, 120) + '...'
        });
        current = '';
      }
    }
    return blocks;
  }

  private findDuplicates(blocks: CodeBlock[]): Map<string, CodeBlock[]> {
    const map = new Map<string, CodeBlock[]>();
    for (const block of blocks) {
      if (!map.has(block.hash)) map.set(block.hash, []);
      map.get(block.hash)!.push(block);
    }
    return map;
  }

  private createDuplicationIssue(group: CodeBlock[]): GuardianIssue {
    const locations = group.slice(0, 3).map(b => `${path.basename(b.filePath)}:${b.startLine}`).join(', ');
    const uniqueFiles = Array.from(new Set(group.map(b => b.filePath)));

    return {
      id: `dup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: GuardianIssueType.CODE_DUPLICATION,
      severity: GuardianSeverity.MEDIUM,
      title: `Code-Duplikat in ${uniqueFiles.length} Dateien`,
      description: `Dieser Code-Block ist ${group.length}x dupliziert. Vorkommen: ${locations}`,
      filePath: group[0].filePath,
      lineNumbers: group.map(b => b.startLine),
      createdAt: Date.now(),
      metadata: {
        source: GuardianSource.PATTERN_RECOGNITION,
        relatedFiles: uniqueFiles
      },
      suggestions: [{
        id: `sug-${Date.now()}`,
        type: SuggestionType.EXTRACT_FUNCTION,
        title: 'In Shared Utility extrahieren',
        description: 'Diesen Block in eine gemeinsame Utility-Funktion auslagern',
        action: SuggestionAction.SHOW_ME,
        confidence: 0.9,
        estimatedEffort: EffortLevel.MEDIUM
      }]
    };
  }
}