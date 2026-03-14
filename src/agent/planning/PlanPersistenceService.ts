import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan, PlanStep, TaskStatus } from './types';
import { LogService } from '../../services/LogService';
import { MarkdownTaskParser } from './MarkdownTaskParser';

const log = new LogService('PlanPersistence');

/**
 * Handles persistence of execution plans to Markdown files.
 * Includes a file watcher to sync manual edits back to the system.
 */
export class PlanPersistenceService {
    private parser = new MarkdownTaskParser();
    private watchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private onPlanChangedCallback?: (planId: string, updates: Map<string, TaskStatus>) => void;

    /**
     * Registers a callback for when a plan file is modified externally.
     */
    public onPlanChanged(callback: (planId: string, updates: Map<string, TaskStatus>) => void) {
        this.onPlanChangedCallback = callback;
    }

    /**
     * Gets the path to a plan file.
     */
    public getPlanPath(planId: string): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return null;

        const gentlyDir = path.join(workspaceFolders[0].uri.fsPath, '.gently', 'plans');
        if (!fs.existsSync(gentlyDir)) {
            try {
                fs.mkdirSync(gentlyDir, { recursive: true });
            } catch (err) {
                log.error('Failed to create plans directory', err);
                return null;
            }
        }
        return path.join(gentlyDir, `${planId}.md`);
    }

    /**
     * Persists a plan to a Markdown file.
     */
    public async persistPlan(plan: ExecutionPlan): Promise<void> {
        const planPath = this.getPlanPath(plan.id);
        if (!planPath) return;

        try {
            const completed = plan.steps.filter(s => s.status === 'completed').length;
            const total = plan.steps.length;
            const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

            let md = `# 📋 Execution Plan: ${plan.goal}\n\n`;
            md += `| Property | Value |\n|----------|-------|\n`;
            md += `| **Status** | \`${plan.status}\` |\n`;
            md += `| **Progress** | ${completed}/${total} (${percentage}%) |\n`;
            md += `| **Created** | ${new Date(plan.createdAt).toLocaleString()} |\n`;
            if (plan.startedAt) md += `| **Started** | ${new Date(plan.startedAt).toLocaleString()} |\n`;
            if (plan.completedAt) md += `| **Completed** | ${new Date(plan.completedAt).toLocaleString()} |\n`;
            md += `\n## Tasks\n\n`;

            for (const step of plan.steps) {
                const checkbox = `[${this.parser.getCheckboxChar(step.status)}]`;
                const statusEmoji = this.parser.getStatusEmoji(step.status);

                md += `- ${checkbox} ${statusEmoji} **${step.id}**: ${step.description}\n`;
                md += `  - 🔧 Tool: \`${step.tool}\`\n`;

                if (step.dependencies && step.dependencies.length > 0) {
                    md += `  - 🔗 Depends on: ${step.dependencies.join(', ')}\n`;
                }

                if (step.result) {
                    const resultStr = typeof step.result === 'object'
                        ? JSON.stringify(step.result, null, 2)
                        : String(step.result);
                    const truncated = resultStr.length > 500
                        ? resultStr.substring(0, 500) + '... (truncated)'
                        : resultStr;
                    md += `  - ✅ **Result:** \`${truncated}\`\n`;
                }

                if (step.error) {
                    md += `  - ❌ **Error:** \`${step.error}\`\n`;
                }
            }

            // Temporarily ignore changes we make ourselves to avoid loops
            this.stopWatching(plan.id);
            await fs.promises.writeFile(planPath, md, 'utf-8');
            this.startWatching(plan.id);

            log.debug(`Plan ${plan.id} persisted to ${planPath}`);
        } catch (error) {
            log.error(`Failed to persist plan ${plan.id}`, error);
            throw error;
        }
    }

    /**
     * Loads a plan from a Markdown file.
     */
    public async loadPlan(planId: string): Promise<ExecutionPlan | null> {
        const planPath = this.getPlanPath(planId);
        if (!planPath || !fs.existsSync(planPath)) return null;

        try {
            const content = await fs.promises.readFile(planPath, 'utf-8');
            const goalMatch = content.match(/# 📋 Execution Plan: (.*)/);
            const goal = goalMatch ? goalMatch[1].trim() : 'Recovered Plan';

            const statusMap = this.parser.parseTaskStatuses(content);
            const steps: PlanStep[] = [];
            
            // Reconstruct steps from lines (this part is still slightly complex because we need the full Step objects)
            // But for loading a NEW plan from MD, we usually have limited info. 
            // In reality, this is mostly used for recovery.
            
            let index = 0;
            for (const [id, status] of statusMap.entries()) {
                steps.push({
                    id,
                    description: `Recovered Step ${id}`,
                    tool: 'unknown',
                    parameters: {},
                    status
                });
            }

            this.startWatching(planId);

            return {
                id: planId,
                goal,
                steps,
                status: 'pending',
                createdAt: Date.now(),
                currentStepIndex: 0,
                totalSteps: steps.length,
                completedSteps: steps.filter(s => s.status === 'completed').length,
                failedSteps: steps.filter(s => s.status === 'failed').length
            };
        } catch (error) {
            log.error(`Failed to load plan ${planId}`, error);
            return null;
        }
    }

    private startWatching(planId: string) {
        if (this.watchers.has(planId)) return;

        const planPath = this.getPlanPath(planId);
        if (!planPath) return;

        const watcher = vscode.workspace.createFileSystemWatcher(planPath);
        watcher.onDidChange(async () => {
            log.info(`Plan file changed: ${planId}`);
            try {
                const content = await fs.promises.readFile(planPath, 'utf-8');
                const updates = this.parser.parseTaskStatuses(content);
                if (this.onPlanChangedCallback) {
                    this.onPlanChangedCallback(planId, updates);
                }
            } catch (err) {
                log.error(`Failed to read updated plan file ${planId}`, err);
            }
        });

        this.watchers.set(planId, watcher);
    }

    private stopWatching(planId: string) {
        const watcher = this.watchers.get(planId);
        if (watcher) {
            watcher.dispose();
            this.watchers.delete(planId);
        }
    }

    public dispose() {
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();
    }
}

