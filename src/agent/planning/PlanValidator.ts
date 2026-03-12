import { ExecutionPlan } from './types';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanValidator');

/**
 * Validates and corrects plan status inconsistencies.
 */
export class PlanValidator {
    validate(plan: ExecutionPlan): { valid: boolean; issues: string[] } {
        const issues: string[] = [];

        // Reset invalid completed steps
        const invalidSteps = plan.steps.filter(s => s.status === 'completed' && !s.result);
        if (invalidSteps.length > 0) {
            issues.push(`Found ${invalidSteps.length} invalid completed steps without results`);
            invalidSteps.forEach(s => {
                s.status = 'pending';
                log.warn(`Resetting invalid step ${s.id} to pending`);
            });
        }

        const hasPending = plan.steps.some(s => s.status === 'pending');
        const hasCompleted = plan.steps.some(s => s.status === 'completed');
        const hasFailed = plan.steps.some(s => s.status === 'failed');
        const allCompleted = plan.steps.every(s => s.status === 'completed');
        const allTerminal = plan.steps.every(s => ['completed', 'failed', 'skipped'].includes(s.status));

        if (plan.status === 'completed' && hasPending) {
            issues.push('Plan completed but has pending steps');
            plan.status = 'executing';
        }

        if (plan.status === 'pending' && hasCompleted) {
            issues.push('Plan pending but has completed steps');
            plan.status = 'executing';
        }

        if (allCompleted && plan.status !== 'completed') {
            plan.status = 'completed';
        }

        if (allTerminal && plan.status === 'executing') {
            plan.status = hasFailed ? 'failed' : 'completed';
        }

        return { valid: issues.length === 0, issues };
    }
}
