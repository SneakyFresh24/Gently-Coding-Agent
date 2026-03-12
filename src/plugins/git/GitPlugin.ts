// =====================================================
// Git Plugin
// =====================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Plugin, PluginContext, Command, Tool } from '../types/PluginTypes';

const execAsync = promisify(exec);

/**
 * Git-Integration-Plugin
 */
export class GitPlugin implements Plugin {
  id = 'git';
  name = 'Git Integration';
  version = '1.0.0';
  description = 'Provides Git commands and tools for the VS Code Agent';
  author = 'VS Code Agent Team';
  
  private context?: PluginContext;
  
  activate(context: PluginContext): void {
    this.context = context;
    
    // Registriere Commands
    this.registerCommands();
    
    // Registriere Tools
    this.registerTools();
    
    // Zeige Benachrichtigung
    context.showInformationMessage('Git Plugin activated');
  }
  
  deactivate(): void {
    // Aufräumarbeiten
    this.context = undefined;
  }
  
  private registerCommands(): void {
    if (!this.context) return;
    
    // Git Status Command
    this.context.registerCommand({
      id: 'status',
      title: 'Git: Show Repository Status',
      category: 'Git',
      handler: async () => {
        const status = await this.getGitStatus();
        const message = status.replace(/\n/g, ' ');
        this.context?.showInformationMessage(`Git Status: ${message}`);
      }
    });
    
    // Git Commit Command
    this.context.registerCommand({
      id: 'commit',
      title: 'Git: Commit Changes',
      category: 'Git',
      handler: async () => {
        const message = await vscode.window.showInputBox({
          prompt: 'Enter commit message'
        });
        
        if (message) {
          await this.gitCommit(message);
          this.context?.showInformationMessage(`Committed changes: ${message}`);
        }
      }
    });
    
    // Git Push Command
    this.context.registerCommand({
      id: 'push',
      title: 'Git: Push Changes',
      category: 'Git',
      handler: async () => {
        try {
          await this.gitPush();
          this.context?.showInformationMessage('Pushed changes to remote repository');
        } catch (error) {
          this.context?.showErrorMessage(`Error pushing changes: ${(error as Error).message}`);
        }
      }
    });
  }
  
  private registerTools(): void {
    if (!this.context) return;
    
    // Git Status Tool
    this.context.registerTool({
      id: 'status',
      name: 'git_status',
      description: 'Get the current Git repository status',
      parameters: [],
      handler: async () => {
        return {
          status: await this.getGitStatus(),
          timestamp: new Date().toISOString()
        };
      }
    });
    
    // Git Add Tool
    this.context.registerTool({
      id: 'add',
      name: 'git_add',
      description: 'Add files to Git staging area',
      parameters: [
        {
          name: 'files',
          type: 'array',
          description: 'Array of file paths to add',
          required: true
        }
      ],
      handler: async (params) => {
        const { files } = params;
        const results = [];
        
        for (const file of files) {
          try {
            await this.gitAdd(file);
            results.push({ file, success: true });
          } catch (error) {
            results.push({ file, success: false, error: (error as Error).message });
          }
        }
        
        return { results };
      }
    });
    
    // Git Commit Tool
    this.context.registerTool({
      id: 'commit',
      name: 'git_commit',
      description: 'Commit changes with a message',
      parameters: [
        {
          name: 'message',
          type: 'string',
          description: 'Commit message',
          required: true
        }
      ],
      handler: async (params) => {
        const { message } = params;
        await this.gitCommit(message);
        return {
          message,
          timestamp: new Date().toISOString()
        };
      }
    });
    
    // Git Log Tool
    this.context.registerTool({
      id: 'log',
      name: 'git_log',
      description: 'Get commit history',
      parameters: [
        {
          name: 'limit',
          type: 'number',
          description: 'Maximum number of commits to return',
          required: false,
          defaultValue: 10
        }
      ],
      handler: async (params) => {
        const { limit = 10 } = params;
        const commits = await this.getGitLog(limit);
        return { commits };
      }
    });
  }
  
  private async getGitStatus(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }
    
    const cwd = workspaceFolders[0].uri.fsPath;
    const { stdout } = await execAsync('git status --porcelain', { cwd });
    return stdout;
  }
  
  private async gitAdd(file: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }
    
    const cwd = workspaceFolders[0].uri.fsPath;
    await execAsync(`git add "${file}"`, { cwd });
  }
  
  private async gitCommit(message: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }
    
    const cwd = workspaceFolders[0].uri.fsPath;
    await execAsync(`git commit -m "${message}"`, { cwd });
  }
  
  private async gitPush(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }
    
    const cwd = workspaceFolders[0].uri.fsPath;
    await execAsync('git push', { cwd });
  }
  
  private async getGitLog(limit: number): Promise<any[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }
    
    const cwd = workspaceFolders[0].uri.fsPath;
    const { stdout } = await execAsync(`git log --oneline -${limit}`, { cwd });
    
    const lines = stdout.trim().split('\n');
    return lines.map(line => {
      const [hash, ...messageParts] = line.split(' ');
      return {
        hash,
        message: messageParts.join(' ')
      };
    });
  }
}