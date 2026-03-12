/**
 * Project Structure Analyzer
 * 
 * Automatically analyzes project structure on first message in a session.
 * Provides context-awareness for file operations and code generation.
 * 
 * Inspired by Augment Code's project understanding approach.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ProjectStructure {
  projectType: ProjectType;
  rootPath: string;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  isMonorepo?: boolean;
  framework?: Framework;
  directories: {
    src?: string;
    components?: string;
    pages?: string;
    public?: string;
    tests?: string;
    lib?: string;
    utils?: string;
    api?: string;
    styles?: string;
    apps?: string;
    packages?: string;
  };
  conventions: {
    componentPath: string;
    pagePath?: string;
    utilPath?: string;
    testPath?: string;
  };
  subProjects?: {
    name: string;
    path: string;
    type: ProjectType;
    framework?: Framework;
  }[];
  packageJson?: any;
  tsConfig?: any;
  summary: string;
}

export type ProjectType = 'monorepo' | 'react' | 'nextjs' | 'vue' | 'angular' | 'node' | 'typescript' | 'javascript' | 'unknown';
export type Framework = 'react' | 'nextjs' | 'vue' | 'angular' | 'express' | 'nestjs' | 'vite' | 'cra';

export class ProjectStructureAnalyzer {
  private workspaceRoot: string;
  private cachedStructure?: ProjectStructure;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Analyze project structure
   */
  async analyze(): Promise<ProjectStructure> {
    console.log('[ProjectAnalyzer] ========================================');
    console.log('[ProjectAnalyzer] Starting project structure analysis...');
    console.log('[ProjectAnalyzer] Workspace Root:', this.workspaceRoot);
    console.log('[ProjectAnalyzer] ========================================');
    const startTime = Date.now();

    // Check for package.json
    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    const hasPackageJson = fs.existsSync(packageJsonPath);
    console.log('[ProjectAnalyzer] package.json path:', packageJsonPath);
    console.log('[ProjectAnalyzer] package.json exists:', hasPackageJson);

    let packageJson: any = null;

    if (hasPackageJson) {
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf8');
        packageJson = JSON.parse(content);
        console.log('[ProjectAnalyzer] package.json parsed successfully');
        console.log('[ProjectAnalyzer] Project name:', packageJson.name);
      } catch (error) {
        console.error('[ProjectAnalyzer] Failed to parse package.json:', error);
      }
    } else {
      console.warn('[ProjectAnalyzer] ⚠️ No package.json found! This might not be a Node.js project.');
    }

    // Check for tsconfig.json
    const tsConfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsConfigPath);
    let tsConfig: any = null;

    if (hasTsConfig) {
      try {
        const content = fs.readFileSync(tsConfigPath, 'utf8');
        tsConfig = JSON.parse(content);
      } catch (error) {
        console.error('[ProjectAnalyzer] Failed to parse tsconfig.json:', error);
      }
    }

    // Detect project type and framework
    let { projectType, framework } = this.detectProjectType(packageJson, hasTsConfig);

    // Detect monorepo
    let isMonorepo = false;
    if (
      packageJson?.workspaces ||
      fs.existsSync(path.join(this.workspaceRoot, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(this.workspaceRoot, 'lerna.json')) ||
      fs.existsSync(path.join(this.workspaceRoot, 'turbo.json')) ||
      fs.existsSync(path.join(this.workspaceRoot, 'nx.json'))
    ) {
      isMonorepo = true;
      projectType = 'monorepo';
    }

    // Find sub-projects
    const subProjects = this.findSubProjects();
    if (subProjects.length > 0 && projectType !== 'monorepo') {
      // If we found subprojects in typical monorepo folders, it's likely a monorepo
      const hasMonorepoDirs = subProjects.some(p => p.path.includes('/apps/') || p.path.includes('\\apps\\') || p.path.includes('/packages/') || p.path.includes('\\packages\\'));
      if (hasMonorepoDirs) {
        isMonorepo = true;
        projectType = 'monorepo';
      }
    }

    // Scan directory structure
    console.log('[ProjectAnalyzer] Scanning directory structure...');
    const directories = await this.scanDirectories(subProjects);
    console.log('[ProjectAnalyzer] Found directories:', directories);

    // Determine conventions based on project type
    console.log('[ProjectAnalyzer] Determining conventions...');
    const conventions = this.determineConventions(projectType, framework, directories);
    console.log('[ProjectAnalyzer] Conventions:', conventions);

    // Generate summary
    const summary = this.generateSummary(projectType, framework, directories, packageJson, isMonorepo, subProjects);

    const structure: ProjectStructure = {
      projectType,
      rootPath: this.workspaceRoot,
      hasPackageJson,
      hasTsConfig,
      isMonorepo,
      framework,
      directories,
      conventions,
      subProjects,
      packageJson,
      tsConfig,
      summary
    };

    this.cachedStructure = structure;

    const duration = Date.now() - startTime;
    console.log('[ProjectAnalyzer] ========================================');
    console.log(`[ProjectAnalyzer] ✅ Analysis complete in ${duration}ms`);
    console.log('[ProjectAnalyzer] Project Type:', projectType);
    console.log('[ProjectAnalyzer] Framework:', framework);
    console.log('[ProjectAnalyzer] Directories:', Object.keys(directories));
    console.log('[ProjectAnalyzer] Component Path:', conventions.componentPath);
    console.log('[ProjectAnalyzer] ========================================');

    return structure;
  }

  /**
   * Detect project type and framework (checks root)
   */
  private detectProjectType(packageJson: any, hasTsConfig: boolean): { projectType: ProjectType; framework?: Framework } {
    // Check root package.json
    if (packageJson) {
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps['next']) return { projectType: 'nextjs', framework: 'nextjs' };
      // React
      if (deps['react']) {
        const framework = deps['vite'] ? 'vite' : 'cra';
        return { projectType: 'react', framework };
      }
      if (deps['vue']) return { projectType: 'vue', framework: 'vue' };
      if (deps['@angular/core']) return { projectType: 'angular', framework: 'angular' };
      if (deps['express']) return { projectType: 'node', framework: 'express' };
      if (deps['@nestjs/core']) return { projectType: 'node', framework: 'nestjs' };

      if (packageJson.main || packageJson.type === 'module') return { projectType: 'node' };
    }

    return { projectType: hasTsConfig ? 'typescript' : 'javascript' };
  }

  /**
   * Find sub-projects in a monorepo
   */
  private findSubProjects(): NonNullable<ProjectStructure['subProjects']> {
    const subProjects: NonNullable<ProjectStructure['subProjects']> = [];
    const searchDirs = [this.workspaceRoot];

    // Core monorepo paths
    ['apps', 'packages', 'services', 'libs'].forEach(dir => {
      const fullPath = path.join(this.workspaceRoot, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        searchDirs.push(fullPath);
      }
    });

    for (const searchDir of searchDirs) {
      if (!fs.existsSync(searchDir)) continue;
      try {
        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skipDirs = ['node_modules', '.git', '.vscode', 'dist', 'build', 'out', '.next', 'coverage', 'apps', 'packages', 'services', 'libs'];
          if (skipDirs.includes(entry.name) || entry.name.startsWith('.')) continue;

          const projectPath = path.join(searchDir, entry.name);
          const packageJsonPath = path.join(projectPath, 'package.json');

          if (fs.existsSync(packageJsonPath)) {
            try {
              const subPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
              const subDeps = { ...subPackageJson.dependencies, ...subPackageJson.devDependencies };
              let framework: Framework | undefined;
              let projectType: ProjectType = 'node';

              if (subDeps['next']) { projectType = 'nextjs'; framework = 'nextjs'; }
              else if (subDeps['react']) { projectType = 'react'; framework = subDeps['vite'] ? 'vite' : 'cra'; }
              else if (subDeps['vue']) { projectType = 'vue'; framework = 'vue'; }
              else if (subDeps['@angular/core']) { projectType = 'angular'; framework = 'angular'; }
              else if (subDeps['@nestjs/core']) { projectType = 'node'; framework = 'nestjs'; }
              else if (subDeps['express']) { projectType = 'node'; framework = 'express'; }

              const isRoot = projectPath === this.workspaceRoot;
              if (!isRoot) {
                subProjects.push({ name: subPackageJson.name || entry.name, path: projectPath, type: projectType, framework });
              }
            } catch (e) {
              console.error(`[ProjectAnalyzer] Error parsing ${packageJsonPath}:`, e);
            }
          }
        }
      } catch (e) { }
    }

    return subProjects;
  }

  /**
   * Scan directory structure (recursively checks subdirectories)
   */
  private async scanDirectories(subProjects?: ProjectStructure['subProjects']): Promise<ProjectStructure['directories']> {
    const directories: ProjectStructure['directories'] = {};

    const commonDirs = [
      'src', 'components', 'pages', 'public', 'tests', 'test', '__tests__',
      'lib', 'utils', 'api', 'styles', 'assets', 'hooks', 'context', 'services', 'store',
      'apps', 'packages'
    ];

    // 1. Check root level
    for (const dir of commonDirs) {
      const dirPath = path.join(this.workspaceRoot, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const key = dir.replace('__tests__', 'tests') as keyof ProjectStructure['directories'];
        directories[key] = dir;
      }

      // 2. Check inside src/
      const srcDirPath = path.join(this.workspaceRoot, 'src', dir);
      if (fs.existsSync(srcDirPath) && fs.statSync(srcDirPath).isDirectory()) {
        const key = dir as keyof ProjectStructure['directories'];
        if (!directories[key]) {
          directories[key] = `src/${dir}`;
        }
      }
    }

    // 3. Scan inside sub-projects if any
    if (subProjects) {
      for (const sub of subProjects) {
        const relPath = path.relative(this.workspaceRoot, sub.path).replace(/\\/g, '/');
        for (const dir of ['src', 'components', 'pages', 'tests']) {
          const subDirStructure = path.join(sub.path, dir);
          if (fs.existsSync(subDirStructure) && fs.statSync(subDirStructure).isDirectory()) {
            const key = dir as keyof ProjectStructure['directories'];
            if (!directories[key]) {
              directories[key] = `${relPath}/${dir}`;
            }
          }
        }
      }
    }

    return directories;
  }

  /**
   * Determine file path conventions
   */
  private determineConventions(
    projectType: ProjectType,
    framework: Framework | undefined,
    directories: ProjectStructure['directories']
  ): ProjectStructure['conventions'] {
    const conventions: ProjectStructure['conventions'] = {
      componentPath: 'src/components',
      utilPath: 'src/utils',
      testPath: 'src/__tests__'
    };

    // Next.js conventions
    if (framework === 'nextjs') {
      conventions.componentPath = directories.components || 'components';
      conventions.pagePath = 'pages'; // or 'app' for Next.js 13+

      // Check for app directory (Next.js 13+)
      const appDir = path.join(this.workspaceRoot, 'app');
      if (fs.existsSync(appDir)) {
        conventions.pagePath = 'app';
      }
    }

    // React conventions
    if (projectType === 'react') {
      conventions.componentPath = directories.components || 'src/components';
      conventions.pagePath = directories.pages || 'src/pages';
    }

    // Vue conventions
    if (projectType === 'vue') {
      conventions.componentPath = directories.components || 'src/components';
      conventions.pagePath = directories.pages || 'src/views';
    }

    // Use detected directories if available
    if (directories.components) {
      conventions.componentPath = directories.components;
    }
    if (directories.pages) {
      conventions.pagePath = directories.pages;
    }
    if (directories.utils) {
      conventions.utilPath = directories.utils;
    }
    if (directories.tests) {
      conventions.testPath = directories.tests;
    }

    return conventions;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    projectType: ProjectType,
    framework: Framework | undefined,
    directories: ProjectStructure['directories'],
    packageJson: any,
    isMonorepo: boolean,
    subProjects: ProjectStructure['subProjects'] = []
  ): string {
    let summary = `📦 **Project Analysis:**\n\n`;

    // Project type
    const typeStr = this.formatProjectType(projectType);
    if (isMonorepo) {
      summary += `- **Type:** Monorepo Workspace\n`;
    } else if (framework) {
      summary += `- **Type:** ${typeStr} (${this.formatFramework(framework)})\n`;
    } else {
      summary += `- **Type:** ${typeStr}\n`;
    }

    // Project name
    if (packageJson?.name) {
      summary += `- **Name:** ${packageJson.name}\n`;
    }

    // Sub projects
    if (isMonorepo && subProjects.length > 0) {
      summary += `- **Sub-Projects:**\n`;
      subProjects.forEach(sub => {
        const subType = sub.framework ? `${this.formatProjectType(sub.type)} (${this.formatFramework(sub.framework)})` : this.formatProjectType(sub.type);
        const relPath = path.relative(this.workspaceRoot, sub.path).replace(/\\/g, '/');
        summary += `  - \`${sub.name}\` (${subType}) in \`${relPath}/\`\n`;
      });
    }

    // Directory structure
    summary += `- **Structure:**\n`;
    const dirList = Object.entries(directories)
      .map(([key, value]) => `  - \`${value}/\` (${key})`)
      .join('\n');
    summary += dirList || '  - No standard directories detected';

    summary += `\n\n✅ Project structure analyzed and cached for this session.`;

    return summary;
  }

  private formatProjectType(type: ProjectType): string {
    const map: Record<ProjectType, string> = {
      monorepo: 'Monorepo Workspace',
      react: 'React',
      nextjs: 'Next.js',
      vue: 'Vue.js',
      angular: 'Angular',
      node: 'Node.js',
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      unknown: 'Unknown'
    };
    return map[type];
  }

  private formatFramework(framework: Framework): string {
    const map: Record<Framework, string> = {
      react: 'React',
      nextjs: 'Next.js',
      vue: 'Vue',
      angular: 'Angular',
      express: 'Express',
      nestjs: 'NestJS',
      vite: 'Vite',
      cra: 'Create React App'
    };
    return map[framework];
  }

  /**
   * Get cached structure
   */
  getCachedStructure(): ProjectStructure | undefined {
    return this.cachedStructure;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cachedStructure = undefined;
  }
}

