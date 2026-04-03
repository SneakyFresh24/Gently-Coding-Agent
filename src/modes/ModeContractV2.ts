import { AgentTool } from '../agent/agentManager/AgentManager';

export type ModeContractId = 'PLAN_STRICT' | 'ACT_STRICT' | 'UNKNOWN';
export type CanonicalModeId = 'plan' | 'act' | 'unknown';

type RuntimeModeId = 'architect' | 'code';

const PLAN_STRICT_ALLOWED_TOOLS = new Set<string>([
  'find_files',
  'regex_search',
  'list_files',
  'recall_memories',
  'read_file',
  'analyze_project_structure',
  'create_plan',
  'handover_to_coder',
  'ask_question',
  'update_memory_bank',
  'query_long_term_memory'
]);

const ACT_STRICT_BLOCKED_TOOLS = new Set<string>([
  'create_plan',
  'handover_to_coder',
  'ask_question'
]);

export function normalizeModeAlias(modeId?: string | null): RuntimeModeId | null {
  if (!modeId) return null;
  const normalized = modeId.trim().toLowerCase();
  if (normalized === 'architect' || normalized === 'plan') return 'architect';
  if (normalized === 'code' || normalized === 'act') return 'code';
  return null;
}

export function toCanonicalModeId(modeId?: string | null): CanonicalModeId {
  const runtime = normalizeModeAlias(modeId);
  if (runtime === 'architect') return 'plan';
  if (runtime === 'code') return 'act';
  return 'unknown';
}

export function resolveModeContract(modeId?: string | null): ModeContractId {
  const normalized = normalizeModeAlias(modeId);
  if (normalized === 'architect') return 'PLAN_STRICT';
  if (normalized === 'code') return 'ACT_STRICT';
  return 'UNKNOWN';
}

export function isToolAllowedForModeContract(modeId: string | undefined | null, toolName: string): boolean {
  const contract = resolveModeContract(modeId);
  if (contract === 'PLAN_STRICT') {
    return PLAN_STRICT_ALLOWED_TOOLS.has(toolName);
  }
  if (contract === 'ACT_STRICT') {
    return !ACT_STRICT_BLOCKED_TOOLS.has(toolName);
  }
  return true;
}

export function filterToolsForModeContract(modeId: string | undefined | null, tools: AgentTool[]): AgentTool[] {
  return tools.filter((tool) => {
    const toolName = String((tool as any)?.name || (tool as any)?.function?.name || '');
    if (!toolName) return false;
    return isToolAllowedForModeContract(modeId, toolName);
  });
}

export function getModeContractViolation(modeId: string | undefined | null, toolName: string): string | null {
  const contract = resolveModeContract(modeId);
  if (contract === 'PLAN_STRICT' && !PLAN_STRICT_ALLOWED_TOOLS.has(toolName)) {
    return `PLAN_STRICT forbids tool "${toolName}".`;
  }
  if (contract === 'ACT_STRICT' && ACT_STRICT_BLOCKED_TOOLS.has(toolName)) {
    return `ACT_STRICT forbids planning tool "${toolName}".`;
  }
  return null;
}
