/**
 * Pattern Recognition Types for Auto-Learning
 * 
 * Tracks user corrections and detects patterns to automatically
 * suggest or create memories.
 */

import { MemoryId, PatternId, CorrectionId } from './types';

export type CorrectionType =
  | 'code_style'        // Code style corrections (e.g., adding semicolons)
  | 'documentation'     // Documentation additions (e.g., JSDoc)
  | 'naming'            // Naming convention corrections
  | 'structure'         // Code structure changes
  | 'testing'           // Test-related corrections
  | 'imports'           // Import statement corrections
  | 'formatting'        // Formatting corrections
  | 'other';            // Other corrections

export type PatternStatus =
  | 'detecting'         // Still collecting data
  | 'ready'             // Ready to suggest
  | 'suggested'         // Suggestion made to user
  | 'accepted'          // User accepted, memory created
  | 'rejected';         // User rejected

export interface CorrectionPattern {
  id: PatternId;
  type: CorrectionType;
  pattern: string;              // Description of the pattern
  examples: string[];           // Examples of corrections
  occurrences: number;          // How many times seen
  firstSeen: number;            // Timestamp of first occurrence
  lastSeen: number;             // Timestamp of last occurrence
  confidence: number;           // 0-1, how confident we are
  status: PatternStatus;
  suggestedMemoryContent?: string;  // Suggested memory content
  createdMemoryId?: MemoryId;     // ID of created memory (if accepted)
}

export interface UserCorrection {
  id: CorrectionId;
  timestamp: number;
  context: string;              // What was the agent doing?
  originalContent: string;      // What the agent generated
  correctedContent: string;     // What the user changed it to
  correctionType: CorrectionType;
  detectedPattern?: PatternId;     // Pattern ID if detected
  fileType?: string;            // File extension (e.g., 'ts', 'py')
  filePath?: string;            // File path
}

export interface PatternSuggestion {
  patternId: PatternId;
  pattern: CorrectionPattern;
  suggestedMemory: {
    content: string;
    category: 'preference' | 'codebase' | 'workflow' | 'tech-stack' | 'general';
  };
  reasoning: string;            // Why we suggest this
  confidence: number;           // 0-1
}

export interface PatternStats {
  totalCorrections: number;
  byType: Record<CorrectionType, number>;
  activePatterns: number;
  suggestedPatterns: number;
  acceptedPatterns: number;
  rejectedPatterns: number;
  topPatterns: CorrectionPattern[];
}

