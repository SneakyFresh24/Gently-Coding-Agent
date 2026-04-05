import * as path from 'path';
import { AutoApprovalActions, AutoApprovalSettings } from '../types/approval';

const ALWAYS_SAFE_TOOLS = new Set<string>([
  'recall_memories',
  'query_long_term_memory',
  'analyze_project_structure',
  'get_context',
  'list_checkpoints',
  'show_checkpoint_diff',
  'check_dev_server',
  'check_memory_conflicts',
  'check_pattern_suggestions',
  'create_plan',
  'update_plan_steps',
  'handover_to_coder',
  'ask_question',
  'create_checkpoint'
]);

const READ_TOOLS = new Set<string>([
  'read_file',
  'list_files',
  'find_files',
  'regex_search',
  'search_files'
]);

const EDIT_TOOLS = new Set<string>([
  'write_file',
  'edit_file',
  'safe_edit_file',
  'apply_block_edit',
  'delete_file',
  'update_memory_bank',
  'remember',
  'update_memory',
  'deprecate_memory',
  'record_correction',
  'accept_pattern_suggestion',
  'reject_pattern_suggestion',
  'restore_checkpoint'
]);

const COMMAND_TOOLS = new Set<string>([
  'run_command',
  'execute_command',
  'run_terminal_command'
]);

const BROWSER_TOOLS = new Set<string>([
  'web_search',
  'search_web'
]);

const SAFE_COMMAND_PREFIXES = [
  'pwd',
  'ls',
  'dir',
  'echo',
  'cat',
  'type',
  'git status',
  'git diff',
  'git log',
  'npm test',
  'npm run test'
];

type ToolParamRecord = Record<string, unknown>;

export type PermissionDecisionReason =
  | 'yolo_mode'
  | 'always_safe_tool'
  | 'policy_allowed'
  | 'policy_denied'
  | 'unknown_tool';

export interface ToolPermissionDecision {
  approved: boolean;
  reason: PermissionDecisionReason;
  policyAction: keyof AutoApprovalActions | null;
  normalizedToolName: string;
  externalPath: boolean;
  safeCommand: boolean;
}

interface ToolPolicyResolution {
  action: keyof AutoApprovalActions | null;
  externalPath: boolean;
  safeCommand: boolean;
}

export function evaluateToolPermissionDecision(
  toolName: string,
  params: unknown,
  settings: AutoApprovalSettings,
  workspaceRoots: string[]
): ToolPermissionDecision {
  const normalizedToolName = normalizeToolName(toolName);
  if (settings.yoloMode) {
    return {
      approved: true,
      reason: 'yolo_mode',
      policyAction: null,
      normalizedToolName,
      externalPath: false,
      safeCommand: false
    };
  }

  if (ALWAYS_SAFE_TOOLS.has(normalizedToolName)) {
    return {
      approved: true,
      reason: 'always_safe_tool',
      policyAction: null,
      normalizedToolName,
      externalPath: false,
      safeCommand: false
    };
  }

  const resolution = resolveToolPolicyAction(normalizedToolName, params, workspaceRoots);
  if (!resolution.action) {
    return {
      approved: false,
      reason: 'unknown_tool',
      policyAction: null,
      normalizedToolName,
      externalPath: resolution.externalPath,
      safeCommand: resolution.safeCommand
    };
  }

  const approved =
    resolution.action === 'executeSafeCommands'
      ? settings.actions.executeAllCommands || settings.actions.executeSafeCommands
      : resolution.action === 'executeAllCommands'
        ? settings.actions.executeAllCommands
        : settings.actions[resolution.action];

  return {
    approved,
    reason: approved ? 'policy_allowed' : 'policy_denied',
    policyAction: resolution.action,
    normalizedToolName,
    externalPath: resolution.externalPath,
    safeCommand: resolution.safeCommand
  };
}

export function resolveToolPolicyAction(
  toolName: string,
  params: unknown,
  workspaceRoots: string[]
): ToolPolicyResolution {
  const normalizedToolName = normalizeToolName(toolName);
  const normalizedParams = normalizeToolParams(params);
  const externalPath = isExternalPath(normalizedParams, workspaceRoots);

  if (READ_TOOLS.has(normalizedToolName)) {
    return {
      action: externalPath ? 'readFilesExternally' : 'readFiles',
      externalPath,
      safeCommand: false
    };
  }

  if (EDIT_TOOLS.has(normalizedToolName)) {
    return {
      action: externalPath ? 'editFilesExternally' : 'editFiles',
      externalPath,
      safeCommand: false
    };
  }

  if (COMMAND_TOOLS.has(normalizedToolName)) {
    const safeCommand = isSafeCommand(normalizedParams.command);
    return {
      action: safeCommand ? 'executeSafeCommands' : 'executeAllCommands',
      externalPath,
      safeCommand
    };
  }

  if (BROWSER_TOOLS.has(normalizedToolName) || normalizedToolName.includes('browser')) {
    return {
      action: 'useBrowser',
      externalPath,
      safeCommand: false
    };
  }

  if (normalizedToolName.includes('mcp')) {
    return {
      action: 'useMcp',
      externalPath,
      safeCommand: false
    };
  }

  return {
    action: null,
    externalPath,
    safeCommand: false
  };
}

function normalizeToolName(toolName: string): string {
  return String(toolName || '').trim().toLowerCase();
}

function normalizeToolParams(params: unknown): ToolParamRecord {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {};
  }
  return params as ToolParamRecord;
}

function isExternalPath(params: ToolParamRecord, workspaceRoots: string[]): boolean {
  const rawPaths = extractPaths(params);
  if (rawPaths.length === 0) {
    return false;
  }

  if (workspaceRoots.length === 0) {
    return true;
  }

  for (const rawPath of rawPaths) {
    const inWorkspace = workspaceRoots.some((root) => {
      const normalizedRoot = path.normalize(root);
      const candidatePath = path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.normalize(path.join(normalizedRoot, rawPath));
      return isWithinRoot(candidatePath, normalizedRoot);
    });
    if (!inWorkspace) {
      return true;
    }
  }
  return false;
}

function extractPaths(params: ToolParamRecord): string[] {
  const paths = new Set<string>();
  const candidates = [
    params.path,
    params.file_path,
    params.targetPath,
    params.directory,
    params.filename,
    params.filePath
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      paths.add(candidate.trim());
    }
  }

  const fileEdits = params.file_edits;
  if (Array.isArray(fileEdits)) {
    for (const fileEdit of fileEdits) {
      if (!fileEdit || typeof fileEdit !== 'object') continue;
      const edit = fileEdit as ToolParamRecord;
      const nestedPath = edit.file_path || edit.path;
      if (typeof nestedPath === 'string' && nestedPath.trim().length > 0) {
        paths.add(nestedPath.trim());
      }
    }
  }

  return Array.from(paths);
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = path.normalize(candidatePath).toLowerCase();
  const normalizedRoot = path.normalize(rootPath).replace(/[\\\/]+$/, '').toLowerCase();
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function isSafeCommand(commandValue: unknown): boolean {
  if (typeof commandValue !== 'string') {
    return false;
  }
  const trimmed = commandValue.trim().toLowerCase();
  return SAFE_COMMAND_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}
