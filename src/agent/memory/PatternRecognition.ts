/**
 * Pattern Recognition System for Auto-Learning
 * 
 * Detects patterns in user corrections and suggests memories automatically.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  CorrectionPattern,
  UserCorrection,
  CorrectionType,
  PatternSuggestion,
  PatternStats,
  PatternStatus
} from './patternTypes';
import { MemoryId, PatternId, CorrectionId } from './types';
import { OpenRouterService } from '../../services/OpenRouterService';

export class PatternRecognition {
  private corrections: Map<CorrectionId, UserCorrection> = new Map();
  private patterns: Map<PatternId, CorrectionPattern> = new Map();
  private workspaceRoot: string;
  private correctionsPath: string;
  private patternsPath: string;
  private openRouterService?: OpenRouterService;

  private correctionStrategies: Map<CorrectionType, (orig: string, corr: string, fileType?: string) => boolean> = new Map();
  private regexPatterns: Map<CorrectionType, RegExp[]> = new Map();

  // Thresholds for pattern detection
  private readonly MIN_OCCURRENCES = 3;      // Minimum occurrences to detect pattern
  private readonly MIN_CONFIDENCE = 0.7;     // Minimum confidence to suggest
  private readonly SIMILARITY_THRESHOLD = 0.8; // Similarity threshold for grouping

  constructor(workspaceRoot: string, openRouterService?: OpenRouterService) {
    this.workspaceRoot = workspaceRoot;
    this.correctionsPath = path.join(workspaceRoot, '.gently', 'corrections.json');
    this.patternsPath = path.join(workspaceRoot, '.gently', 'patterns.json');
    this.openRouterService = openRouterService;
  }

  /**
   * Initialize pattern recognition system
   */
  async initialize(): Promise<void> {
    console.log('[PatternRecognition] Initializing...');
    this.initializeStrategies();
    await this.loadCorrections();
    await this.loadPatterns();
    console.log(`[PatternRecognition] Loaded ${this.corrections.size} corrections and ${this.patterns.size} patterns`);
  }

  /**
   * Initialize correction detection strategies
   */
  private initializeStrategies(): void {
    // 1. Regex Patterns for high-precision detection
    this.regexPatterns.set('documentation', [
      /\/\*\*/, /jsdoc/, /@param/, /@returns/, /\/\//
    ]);
    this.regexPatterns.set('testing', [
      /test\(/, /expect\(/, /assert\./, /describe\(/, /it\(/, /Suite\(/
    ]);
    this.regexPatterns.set('imports', [
      /^import\s+/, /^export\s+/, /require\(/, /from\s+['"]/
    ]);
    this.regexPatterns.set('formatting', [
      /^\s+$/, /^{}\s*$/, /\[\]\s*$/
    ]);

    // 2. Functional Strategies
    this.correctionStrategies.set('documentation', (orig, corr) =>
      this.regexPatterns.get('documentation')!.some(re => re.test(corr)) && !this.regexPatterns.get('documentation')!.some(re => re.test(orig)));

    this.correctionStrategies.set('testing', (orig, corr) =>
      this.regexPatterns.get('testing')!.some(re => re.test(corr)));

    this.correctionStrategies.set('imports', (orig, corr) =>
      this.regexPatterns.get('imports')!.some(re => re.test(corr)) && !orig.includes(corr));

    this.correctionStrategies.set('naming', (orig, corr) => this.hasNamingChange(orig, corr));
    this.correctionStrategies.set('code_style', (orig, corr) => this.hasStyleChange(orig, corr));
    this.correctionStrategies.set('structure', (orig, corr) => this.hasStructureChange(orig, corr));
    this.correctionStrategies.set('formatting', (orig, corr) => this.hasFormattingChange(orig, corr));
  }

  /**
   * Record a user correction
   */
  async recordCorrection(
    context: string,
    originalContent: string,
    correctedContent: string,
    fileType?: string,
    filePath?: string
  ): Promise<UserCorrection> {
    const correctionType = await this.detectCorrectionType(originalContent, correctedContent, fileType);

    const correction: UserCorrection = {
      id: this.generateCorrectionId(),
      timestamp: Date.now(),
      context,
      originalContent,
      correctedContent,
      correctionType,
      fileType,
      filePath
    };

    this.corrections.set(correction.id, correction);
    await this.saveCorrections();

    console.log(`[PatternRecognition] Recorded correction: ${correctionType}`);

    // Try to detect patterns
    await this.detectPatterns();

    return correction;
  }

  /**
   * Detect patterns from corrections
   */
  private async detectPatterns(): Promise<void> {
    const correctionsByType = this.groupCorrectionsByType();

    for (const [type, corrections] of correctionsByType.entries()) {
      if (corrections.length < this.MIN_OCCURRENCES) {
        continue;
      }

      // Analyze corrections to find patterns
      const detectedPattern = this.analyzeCorrections(type, corrections);

      if (detectedPattern && detectedPattern.confidence >= this.MIN_CONFIDENCE) {
        // Check if pattern already exists
        const existingPattern = this.findSimilarPattern(detectedPattern);

        if (existingPattern) {
          // Update existing pattern
          existingPattern.occurrences++;
          existingPattern.lastSeen = Date.now();
          existingPattern.examples.push(...detectedPattern.examples);
          existingPattern.confidence = Math.min(1.0, existingPattern.confidence + 0.1);
        } else {
          // Create new pattern
          this.patterns.set(detectedPattern.id, detectedPattern);
          console.log(`[PatternRecognition] New pattern detected: ${detectedPattern.pattern}`);
        }

        await this.savePatterns();
      }
    }
  }

  /**
   * Get patterns ready for suggestion
   */
  getReadyPatterns(): CorrectionPattern[] {
    return Array.from(this.patterns.values())
      .filter(p =>
        p.status === 'detecting' &&
        p.occurrences >= this.MIN_OCCURRENCES &&
        p.confidence >= this.MIN_CONFIDENCE
      )
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Generate suggestion from pattern
   */
  generateSuggestion(pattern: CorrectionPattern): PatternSuggestion {
    const memoryContent = this.generateMemoryContent(pattern);
    const category = this.detectMemoryCategory(pattern);

    return {
      patternId: pattern.id,
      pattern,
      suggestedMemory: {
        content: memoryContent,
        category
      },
      reasoning: this.generateReasoning(pattern),
      confidence: pattern.confidence
    };
  }

  /**
   * Mark pattern as accepted
   */
  async markAsAccepted(patternId: PatternId, memoryId: MemoryId): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.status = 'accepted';
      pattern.createdMemoryId = memoryId;
      await this.savePatterns();
      console.log(`[PatternRecognition] Pattern accepted: ${pattern.pattern}`);
    }
  }

  /**
   * Mark pattern as rejected
   */
  async markAsRejected(patternId: PatternId): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.status = 'rejected';
      await this.savePatterns();
      console.log(`[PatternRecognition] Pattern rejected: ${pattern.pattern}`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): PatternStats {
    const corrections = Array.from(this.corrections.values());
    const patterns = Array.from(this.patterns.values());

    const byType: Record<CorrectionType, number> = {
      code_style: 0,
      documentation: 0,
      naming: 0,
      structure: 0,
      testing: 0,
      imports: 0,
      formatting: 0,
      other: 0
    };

    corrections.forEach(c => byType[c.correctionType]++);

    return {
      totalCorrections: corrections.length,
      byType,
      activePatterns: patterns.filter(p => p.status === 'detecting').length,
      suggestedPatterns: patterns.filter(p => p.status === 'suggested').length,
      acceptedPatterns: patterns.filter(p => p.status === 'accepted').length,
      rejectedPatterns: patterns.filter(p => p.status === 'rejected').length,
      topPatterns: patterns
        .filter(p => p.status === 'accepted')
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 5)
    };
  }

  /**
   * Clear all corrections and patterns
   */
  async clearAll(): Promise<void> {
    this.corrections.clear();
    this.patterns.clear();
    await this.saveCorrections();
    await this.savePatterns();
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Detect correction type
   */
  private async detectCorrectionType(
    original: string,
    corrected: string,
    fileType?: string
  ): Promise<CorrectionType> {
    const orig = original.trim();
    const corr = corrected.trim();

    for (const [type, strategy] of this.correctionStrategies.entries()) {
      if (strategy(orig, corr, fileType)) {
        return type;
      }
    }

    // LLM Fallback for complex structural changes
    if (this.openRouterService && orig.length > 20 && corr.length > 20) {
      return await this.detectCorrectionTypeLLM(orig, corr);
    }

    return 'other';
  }

  /**
   * Detect correction type using LLM
   */
  private async detectCorrectionTypeLLM(original: string, corrected: string): Promise<CorrectionType> {
    if (!this.openRouterService) return 'other';

    try {
      const prompt = `Categorize this code correction into one of: [code_style, documentation, naming, structure, testing, imports, formatting, other].
Original: "${original.substring(0, 500)}"
Corrected: "${corrected.substring(0, 500)}"

Return ONLY the category name.`;

      const response = await this.openRouterService.sendChatMessage({
        messages: [{ role: 'user', content: prompt }],
        model: 'deepseek/deepseek-chat',
        temperature: 0,
        max_tokens: 10
      });

      interface OpenRouterResponse {
        choices?: Array<{
          message?: {
            content: string;
          };
        }>;
      }

      const data = await response.json() as OpenRouterResponse;
      const category = (data.choices?.[0]?.message?.content || '').trim().toLowerCase() as CorrectionType;

      const validCategories: CorrectionType[] = ['code_style', 'documentation', 'naming', 'structure', 'testing', 'imports', 'formatting', 'other'];
      return validCategories.includes(category) ? category : 'other';
    } catch (error) {
      return 'other';
    }
  }

  /**
   * Group corrections by type
   */
  private groupCorrectionsByType(): Map<CorrectionType, UserCorrection[]> {
    const grouped = new Map<CorrectionType, UserCorrection[]>();

    for (const correction of this.corrections.values()) {
      const existing = grouped.get(correction.correctionType) || [];
      existing.push(correction);
      grouped.set(correction.correctionType, existing);
    }

    return grouped;
  }

  /**
   * Analyze corrections to find pattern
   */
  private analyzeCorrections(
    type: CorrectionType,
    corrections: UserCorrection[]
  ): CorrectionPattern | null {
    if (corrections.length < this.MIN_OCCURRENCES) {
      return null;
    }

    // Find common pattern
    const pattern = this.findCommonPattern(corrections);
    if (!pattern) return null;

    const confidenceValue = Math.min(1.0, corrections.length / 10);

    return {
      id: this.generatePatternId(),
      type,
      pattern,
      examples: corrections.slice(0, 3).map(c => c.correctedContent),
      occurrences: corrections.length,
      firstSeen: Math.min(...corrections.map(c => c.timestamp)),
      lastSeen: Math.max(...corrections.map(c => c.timestamp)),
      confidence: confidenceValue,
      status: 'detecting'
    };
  }

  /**
   * Find common pattern in corrections
   */
  private findCommonPattern(corrections: UserCorrection[]): string | null {
    if (corrections.length === 0) return null;
    const type = corrections[0].correctionType;

    if (type === 'other' || type === 'code_style') {
      const commonStr = this.findLongestCommonSubstring(
        corrections[0].correctedContent,
        corrections[1].correctedContent
      );
      if (commonStr && commonStr.length > 5) {
        return `Consistent use of "${commonStr}" pattern`;
      }
    }

    switch (type) {
      case 'documentation': return 'User adds documentation comments to functions';
      case 'testing': return 'User adds tests for new functionality';
      case 'code_style': return this.detectStylePattern(corrections);
      case 'naming': return this.detectNamingPattern(corrections);
      case 'imports': return 'User organizes or adds imports';
      default: return null;
    }
  }

  /**
   * Find longest common substring between two strings
   */
  private findLongestCommonSubstring(s1: string, s2: string): string {
    const matrix = Array.from({ length: s1.length + 1 }, () => new Array(s2.length + 1).fill(0));
    let maxLength = 0, endIndex = 0;

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
          if (matrix[i][j] > maxLength) {
            maxLength = matrix[i][j];
            endIndex = i;
          }
        }
      }
    }
    return s1.substring(endIndex - maxLength, endIndex);
  }

  /**
   * Detect style pattern
   */
  private detectStylePattern(corrections: UserCorrection[]): string | null {
    const addsSemicolons = corrections.filter(c => !c.originalContent.includes(';') && c.correctedContent.includes(';')).length;
    if (addsSemicolons >= this.MIN_OCCURRENCES) return 'User adds semicolons to statements';

    const changesQuotes = corrections.filter(c => c.originalContent.includes('"') && c.correctedContent.includes("'")).length;
    if (changesQuotes >= this.MIN_OCCURRENCES) return 'User prefers single quotes over double quotes';

    return 'User has specific code style preferences';
  }

  /**
   * Detect naming pattern
   */
  private detectNamingPattern(corrections: UserCorrection[]): string | null {
    return 'User has specific naming conventions';
  }

  /**
   * Find similar pattern
   */
  private findSimilarPattern(pattern: CorrectionPattern): CorrectionPattern | null {
    for (const existing of this.patterns.values()) {
      if (existing.type === pattern.type && existing.pattern === pattern.pattern && existing.status !== 'rejected') return existing;
    }
    return null;
  }

  /**
   * Generate memory content from pattern
   */
  private generateMemoryContent(pattern: CorrectionPattern): string {
    switch (pattern.type) {
      case 'documentation': return 'Always add JSDoc comments to functions';
      case 'testing': return 'Always write tests for new functionality';
      case 'code_style':
        if (pattern.pattern.includes('semicolons')) return 'Always use semicolons at end of statements';
        if (pattern.pattern.includes('single quotes')) return 'Prefer single quotes over double quotes';
        return 'Follow specific code style guidelines';
      case 'naming': return 'Follow specific naming conventions';
      case 'imports': return 'Organize imports in a specific way';
      default: return pattern.pattern;
    }
  }

  /**
   * Detect memory category
   */
  private detectMemoryCategory(pattern: CorrectionPattern): 'preference' | 'codebase' | 'workflow' | 'tech-stack' | 'general' {
    switch (pattern.type) {
      case 'code_style': case 'naming': case 'formatting': return 'preference';
      case 'structure': case 'imports': return 'codebase';
      case 'testing': case 'documentation': return 'workflow';
      default: return 'general';
    }
  }

  /**
   * Generate reasoning for suggestion
   */
  private generateReasoning(pattern: CorrectionPattern): string {
    return `I've noticed you've made this correction ${pattern.occurrences} times. Would you like me to remember this as a preference?`;
  }

  // Helper methods for detection
  private hasNamingChange(original: string, corrected: string): boolean {
    return original !== corrected && (this.hasCaseChange(original, corrected) || this.hasUnderscoreChange(original, corrected));
  }

  private hasCaseChange(original: string, corrected: string): boolean {
    return original.toLowerCase() === corrected.toLowerCase() && original !== corrected;
  }

  private hasUnderscoreChange(original: string, corrected: string): boolean {
    return (original.includes('_') && !corrected.includes('_')) || (!original.includes('_') && corrected.includes('_'));
  }

  private hasStyleChange(original: string, corrected: string): boolean {
    const semiChange = (original.match(/;/g) || []).length !== (corrected.match(/;/g) || []).length;
    const quoteChange = (original.includes('"') && corrected.includes("'")) || (original.includes("'") && corrected.includes('"'));
    return semiChange || quoteChange;
  }

  private hasStructureChange(original: string, corrected: string): boolean {
    const origLines = original.split('\n').length;
    const corrLines = corrected.split('\n').length;
    return Math.abs(origLines - corrLines) > 2;
  }

  private hasFormattingChange(original: string, corrected: string): boolean {
    return original.trim() === corrected.trim() && original !== corrected;
  }

  private generateCorrectionId(): CorrectionId {
    return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as CorrectionId;
  }

  private generatePatternId(): PatternId {
    return `pat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as PatternId;
  }

  // Storage methods
  private async loadCorrections(): Promise<void> {
    try {
      const content = await fs.readFile(this.correctionsPath, 'utf-8');
      const data = JSON.parse(content);
      if (data.corrections && Array.isArray(data.corrections)) {
        data.corrections.forEach((c: UserCorrection) => this.corrections.set(c.id, c));
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') console.error('[PatternRecognition] Error loading corrections:', error);
    }
  }

  private async saveCorrections(): Promise<void> {
    const data = { version: '1.0', corrections: Array.from(this.corrections.values()) };
    await fs.writeFile(this.correctionsPath, JSON.stringify(data, null, 2));
  }

  private async loadPatterns(): Promise<void> {
    try {
      const content = await fs.readFile(this.patternsPath, 'utf-8');
      const data = JSON.parse(content);
      if (data.patterns && Array.isArray(data.patterns)) {
        data.patterns.forEach((p: CorrectionPattern) => this.patterns.set(p.id, p));
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') console.error('[PatternRecognition] Error loading patterns:', error);
    }
  }

  private async savePatterns(): Promise<void> {
    const data = { version: '1.0', patterns: Array.from(this.patterns.values()) };
    await fs.writeFile(this.patternsPath, JSON.stringify(data, null, 2));
  }
}
