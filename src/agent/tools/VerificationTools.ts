import { VerificationAgent } from '../verification/VerificationAgent';
import { ToolRegistry } from './ToolRegistry';

export class VerificationTools {
    constructor(
        private getVerificationAgent: () => VerificationAgent | undefined
    ) { }

    /**
     * Register all verification-related tools
     */
    registerTools(registry: ToolRegistry): void {
        registry.register('verify_and_auto_fix', this.verifyAndHeal.bind(this));
    }

    private async verifyAndHeal(params: { command: string; max_retries?: number }): Promise<any> {
        try {
            const verificationAgent = this.getVerificationAgent();
            if (!verificationAgent) {
                return {
                    success: false,
                    message: 'Verification Agent is not initialized. Cannot run verify_and_auto_fix.'
                };
            }

            console.log(`[VerificationTools] Executing verify_and_auto_fix with command: ${params.command}`);

            const maxRetries = params.max_retries ?? 3;
            const result = await verificationAgent.verifyAndHeal(params.command, maxRetries);

            if (result.success) {
                let msg = `Command '${params.command}' executed successfully.`;
                if (result.retries > 0) {
                    msg = `Verification failed initially, but the Self-Healing Agent successfully fixed the code after ${result.retries} attempts.\nFiles fixed: ${result.fixedFiles.join(', ')}\n\nFinal command output:\n${result.output}`;
                } else {
                    msg += `\n\nOutput:\n${result.output}`;
                }
                return { success: true, message: msg };
            } else {
                return {
                    success: false,
                    message: `Command '${params.command}' failed even after ${result.retries} self-healing attempts.\nFiles attempted to fix: ${result.fixedFiles.join(', ')}\n\nFinal output:\n${result.output}`
                };
            }
        } catch (error) {
            console.error('[VerificationTools] Error in verify_and_auto_fix:', error);
            return {
                success: false,
                message: `Error verifying command: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}
