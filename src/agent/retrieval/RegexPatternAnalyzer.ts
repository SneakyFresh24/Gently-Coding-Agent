export interface RegexNormalizationOptions {
  flags?: string;
  case_sensitive?: boolean;
  multiline?: boolean;
}

export interface RegexAnalysisResult {
  normalizedFlags: string;
  literals: string[];
  trigrams: string[];
  fallbackReason?: string;
}

export class RegexPatternAnalyzer {
  normalizeFlags(options: RegexNormalizationOptions): string {
    let flags = (options.flags || '').toLowerCase();
    const allowed = new Set(['i', 'm', 's', 'u']);
    const out: string[] = [];

    for (const flag of flags) {
      if (allowed.has(flag) && !out.includes(flag)) {
        out.push(flag);
      }
    }

    if (options.case_sensitive === false && !out.includes('i')) {
      out.push('i');
    }

    if (options.multiline === true && !out.includes('m')) {
      out.push('m');
    }

    return out.join('');
  }

  analyzePattern(pattern: string, options: RegexNormalizationOptions): RegexAnalysisResult {
    const normalizedFlags = this.normalizeFlags(options);

    if (this.hasLikelyUnsupportedFeature(pattern)) {
      return {
        normalizedFlags,
        literals: [],
        trigrams: [],
        fallbackReason: 'unsupported_pattern_feature'
      };
    }

    const literals = this.extractSearchableLiterals(pattern);
    if (literals.length === 0) {
      return {
        normalizedFlags,
        literals: [],
        trigrams: [],
        fallbackReason: 'no_searchable_literals'
      };
    }

    const longest = literals.sort((a, b) => b.length - a.length).slice(0, 3);
    const trigrams = this.extractTrigramsFromLiterals(longest);

    if (trigrams.length === 0) {
      return {
        normalizedFlags,
        literals: longest,
        trigrams: [],
        fallbackReason: 'literals_too_short'
      };
    }

    return { normalizedFlags, literals: longest, trigrams };
  }

  extractSearchableLiterals(pattern: string): string[] {
    const literals: string[] = [];
    let current = '';
    let inClass = false;

    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      const next = pattern[i + 1] || '';

      if (ch === '\\') {
        if (this.isEscapedMeta(next)) {
          if (current.length >= 2) literals.push(current);
          current = '';
          i += 1;
          continue;
        }

        if (next) {
          current += next;
          i += 1;
          continue;
        }

        break;
      }

      if (ch === '[') {
        inClass = true;
        if (current.length >= 2) literals.push(current);
        current = '';
        continue;
      }
      if (ch === ']') {
        inClass = false;
        continue;
      }
      if (inClass) continue;

      if (this.isRegexMeta(ch)) {
        if (current.length >= 2) literals.push(current);
        current = '';
        continue;
      }

      current += ch;
    }

    if (current.length >= 2) {
      literals.push(current);
    }

    return Array.from(new Set(literals.map((s) => s.trim()).filter((s) => s.length >= 2)));
  }

  extractTrigramsFromLiterals(literals: string[]): string[] {
    const trigrams = new Set<string>();

    for (const literal of literals) {
      const normalized = literal.toLowerCase();
      if (normalized.length < 3) continue;
      for (let i = 0; i <= normalized.length - 3; i++) {
        trigrams.add(normalized.slice(i, i + 3));
      }
    }

    return Array.from(trigrams);
  }

  private isEscapedMeta(ch: string): boolean {
    return ['w', 'W', 's', 'S', 'd', 'D', 'b', 'B', 'A', 'Z'].includes(ch);
  }

  private isRegexMeta(ch: string): boolean {
    return ['.', '*', '+', '?', '|', '(', ')', '{', '}', '^', '$'].includes(ch);
  }

  private hasLikelyUnsupportedFeature(pattern: string): boolean {
    const unsupportedPatterns = [
      /\(\?=/,   // positive lookahead
      /\(\?!/,   // negative lookahead
      /\(\?<=/,  // positive lookbehind
      /\(\?<!/,  // negative lookbehind
      /\\[1-9]/  // backreferences
    ];

    return unsupportedPatterns.some((re) => re.test(pattern));
  }
}
