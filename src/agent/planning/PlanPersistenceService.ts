import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan, PlanStep, TaskStatus } from './types';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanPersistence');

/**
 * Handles persistence of execution plans to Markdown files.
 */
export class PlanPersistenceService {
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
                let checkbox = '[ ]';
                let statusEmoji = '⬜';
                if (step.status === 'completed') { checkbox = '[x]'; statusEmoji = '✅'; }
                else if (step.status === 'failed') { checkbox = '[!]'; statusEmoji = '❌'; }
                else if (step.status === 'in-progress') { checkbox = '[/]'; statusEmoji = '🔄'; }
                else if (step.status === 'skipped') { checkbox = '[-]'; statusEmoji = '⏭️'; }

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

            await fs.promises.writeFile(planPath, md, 'utf-8');
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

            const stepLines = content.split('\n').filter(l => l.trim().startsWith('- ['));
            const steps: PlanStep[] = stepLines.map((line, index) => {
                const statusMatch = line.match(/- \[(.)\]/);
                const coreMatch = line.match(/\*\*(step-\d+|\d+[a-zA-Z0-9-]*)\*\*: (.*)/);
                const toolMatch = content.substring(content.indexOf(line)).match(/🔧 Tool: `(.*?)`/);

                const statusMap: Record<string, TaskStatus> = {
                    'x': 'completed',
                    ' ': 'pending',
                    '/': 'in-progress',
                    '!': 'failed',
                    '-': 'skipped'
                };

                const char = statusMatch ? statusMatch[1] : ' ';
                const id = coreMatch ? coreMatch[1] : `step-${index + 1}`;
                const description = coreMatch ? coreMatch[2].trim() : `Step ${id}`;
                const tool = toolMatch ? toolMatch[1] : 'unknown';

                return {
                    id,
                    description,
                    tool,
                    parameters: {},
                    status: statusMap[char] || 'pending'
                };
            });

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
}
