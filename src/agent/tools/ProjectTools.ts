// =====================================================
// Project Tools - Project analysis and structure tools
// =====================================================

import * as vscode from 'vscode';
import { ProjectStructureAnalyzer } from '../ProjectStructureAnalyzer';
import { ProcessDetector } from '../../terminal/ProcessDetector';
import { ToolRegistry } from './ToolRegistry';

export class ProjectTools {
  constructor(
    private projectAnalyzer: ProjectStructureAnalyzer
  ) { }

  /**
   * Register all project-related tools
   */
  registerTools(registry: ToolRegistry): void {
    registry.register('analyze_project_structure', this.analyzeProjectStructure.bind(this));
    registry.register('get_context', this.getContext.bind(this));
    registry.register('check_dev_server', this.checkDevServer.bind(this));
  }

  private async analyzeProjectStructure(params: any): Promise<any> {
    try {
      console.log('[ProjectTools] analyze_project_structure tool called');
      const analysis = await this.projectAnalyzer.analyze();
      console.log('[ProjectTools] Project analysis completed successfully');

      return {
        success: true,
        analysis: {
          projectType: analysis.projectType,
          framework: analysis.framework,
          rootPath: analysis.rootPath,
          hasPackageJson: analysis.hasPackageJson,
          hasTsConfig: analysis.hasTsConfig,
          directories: analysis.directories,
          conventions: analysis.conventions,
          summary: analysis.summary
        }
      };
    } catch (error) {
      console.error('[ProjectTools] Error analyzing project:', error);
      return {
        success: false,
        message: `Error analyzing project: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async getContext(): Promise<any> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const openFiles = vscode.workspace.textDocuments.map(doc =>
        vscode.workspace.asRelativePath(doc.uri)
      );

      const activeEditor = vscode.window.activeTextEditor;
      const currentFile = activeEditor
        ? vscode.workspace.asRelativePath(activeEditor.document.uri)
        : undefined;

      const selectedText = activeEditor?.selection && !activeEditor.selection.isEmpty
        ? activeEditor.document.getText(activeEditor.selection)
        : undefined;

      return {
        workspaceRoot,
        openFiles,
        currentFile,
        selectedText,
        relevantFiles: []
      };
    } catch (error) {
      console.error('[ProjectTools] Error getting context:', error);
      return {
        success: false,
        message: `Error getting context: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkDevServer(): Promise<any> {
    try {
      console.log('[ProjectTools] check_dev_server tool called');
      const result = await ProcessDetector.isDevServerRunning();

      if (result.running) {
        return {
          running: true,
          port: result.port,
          process: result.process,
          message: `Development server is already running on port ${result.port}${result.process ? ` (${result.process})` : ''}. No need to start a new one.`
        };
      } else {
        return {
          running: false,
          message: 'No development server detected. Safe to start one with npm run dev.'
        };
      }
    } catch (error) {
      console.error('[ProjectTools] Error checking dev server:', error);
      return {
        running: false,
        error: `Error checking dev server: ${error}`,
        message: 'Could not detect dev server status. Proceed with caution.'
      };
    }
  }
}