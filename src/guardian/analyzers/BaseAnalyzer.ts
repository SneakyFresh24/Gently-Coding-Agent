/**
 * Base Analyzer Interface
 * 
 * All Guardian analyzers should implement this interface
 */

import { GuardianIssue, GuardianAnalysisContext } from '../types';

export interface IAnalyzer {
  /**
   * Get the unique identifier for this analyzer
   */
  readonly id: string;
  
  /**
   * Get the display name for this analyzer
   */
  readonly name: string;
  
  /**
   * Get the description for this analyzer
   */
  readonly description: string;
  
  /**
   * Analyze the codebase and return issues
   */
  analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]>;
  
  /**
   * Check if this analyzer is enabled
   */
  isEnabled(): boolean;
  
  /**
   * Enable or disable this analyzer
   */
  setEnabled(enabled: boolean): void;
}

/**
 * Abstract base class for analyzers
 */
export abstract class BaseAnalyzer implements IAnalyzer {
  protected enabled: boolean = true;
  
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string
  ) {}
  
  abstract analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]>;
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}