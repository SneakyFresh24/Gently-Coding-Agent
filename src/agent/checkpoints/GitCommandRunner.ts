import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitRunnerOptions {
  gitDir: string;
  workTree: string;
  cwd?: string;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export class GitCommandRunner {
  constructor(private readonly options: GitRunnerOptions) {}

  async run(args: string[], allowFailure = false, includeWorkTree = true): Promise<GitRunResult> {
    const baseArgs = includeWorkTree
      ? [`--git-dir=${this.options.gitDir}`, `--work-tree=${this.options.workTree}`]
      : [];
    const fullArgs = [...baseArgs, ...args];
    try {
      const result = await execFileAsync('git', fullArgs, {
        cwd: this.options.cwd || this.options.workTree,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      });
      return {
        stdout: result.stdout?.toString() || '',
        stderr: result.stderr?.toString() || ''
      };
    } catch (error: any) {
      if (allowFailure) {
        return {
          stdout: String(error?.stdout || ''),
          stderr: String(error?.stderr || error?.message || '')
        };
      }
      const stderr = String(error?.stderr || error?.message || 'git command failed');
      throw new Error(`Git command failed (${args.join(' ')}): ${stderr}`);
    }
  }

  async runWithoutContext(args: string[], allowFailure = false): Promise<GitRunResult> {
    return this.run(args, allowFailure, false);
  }
}
