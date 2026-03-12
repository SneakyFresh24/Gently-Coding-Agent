import { OpenRouterService } from '../../services/OpenRouterService';
import { TerminalManager } from '../../terminal/TerminalManager';
import { FileOperations } from '../fileOperations';
import * as path from 'path';

export interface VerificationResult {
    success: boolean;
    output: string;
    retries: number;
    fixedFiles: string[];
}

export class VerificationAgent {
    constructor(
        private openRouterService: OpenRouterService,
        private terminalManager: TerminalManager | null,
        private fileOps: FileOperations,
        private workspaceRoot: string
    ) { }

    async verifyAndHeal(command: string, maxRetries: number = 3): Promise<VerificationResult> {
        if (!this.terminalManager) {
            throw new Error('TerminalManager not available for VerificationAgent');
        }

        let retries = 0;
        let success = false;
        let lastOutput = '';
        const fixedFiles: string[] = [];

        while (retries < maxRetries) {
            console.log(`[VerificationAgent] Executing command (Attempt ${retries + 1}/${maxRetries}): ${command}`);

            try {
                const result = await this.terminalManager.executeCommand(command, 'Verification Agent Execution', { timeout: 60 });

                lastOutput = result.output;

                if (result.success && result.exitCode === 0) {
                    console.log(`[VerificationAgent] Command succeeded on attempt ${retries + 1}`);
                    success = true;
                    break;
                }

                console.log(`[VerificationAgent] Command failed with exit code ${result.exitCode}. Attempting self-healing...`);

                // Try to heal
                const fixed = await this.attemptSelfHealing(command, lastOutput);

                if (!fixed || fixed.length === 0) {
                    console.log(`[VerificationAgent] Self-healing failed or no fixes proposed.`);
                    break; // Stop retrying if LLM couldn't fix it
                }

                fixedFiles.push(...fixed);
                retries++;

            } catch (error) {
                lastOutput = error instanceof Error ? error.message : String(error);
                console.error(`[VerificationAgent] Error executing command:`, error);
                break; // Stop on critical execution errors (like user rejection)
            }
        }

        return {
            success,
            output: lastOutput,
            retries,
            fixedFiles
        };
    }

    private async attemptSelfHealing(command: string, errorOutput: string): Promise<string[]> {
        try {
            // Create a prompt with the error output
            const prompt = `The command \`${command}\` failed with the following output:

\`\`\`
${errorOutput.substring(0, 4000)} // Truncate if too long
\`\`\`

Analyze this error and fix the broken files. 
You must ONLY output a valid JSON array of objects with the 'path' and 'newContent' fields. Do not output anything else.
Example:
[
  {
    "path": "src/broken-file.ts",
    "newContent": "// full fixed file content here"
  }
]

If you cannot fix it or no file edit is needed, output an empty array [].`;

            console.log('[VerificationAgent] Sending healing request to LLM...');

            const response = await this.openRouterService.sendChatMessage({
                messages: [
                    {
                        role: 'system',
                        content: 'You are an autonomous self-healing agent. You fix compiler and test errors. Always return valid JSON matching the requested schema.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                model: 'deepseek/deepseek-chat',
                stream: false,
                temperature: 0.1, // Low temperature for code fixes
                max_tokens: 4000
            });

            const responseData = await response.json() as any;
            const content = responseData.choices?.[0]?.message?.content;

            if (!content) return [];

            // Extract JSON from markdown code block if present
            let jsonStr = content;
            if (jsonStr.includes('\`\`\`json')) {
                jsonStr = jsonStr.split('\`\`\`json')[1].split('\`\`\`')[0];
            } else if (jsonStr.includes('\`\`\`')) {
                jsonStr = jsonStr.split('\`\`\`')[1].split('\`\`\`')[0];
            }

            const fixes = JSON.parse(jsonStr.trim());

            if (!Array.isArray(fixes)) return [];

            const fixedFilePaths: string[] = [];

            // Apply fixes
            for (const fix of fixes) {
                if (fix.path && fix.newContent) {
                    const absolutePath = path.isAbsolute(fix.path)
                        ? fix.path
                        : path.join(this.workspaceRoot, fix.path);

                    await this.fileOps.writeFile(absolutePath, fix.newContent);
                    fixedFilePaths.push(fix.path);
                    console.log(`[VerificationAgent] Applied fix to ${fix.path}`);
                }
            }

            return fixedFilePaths;

        } catch (error) {
            console.error('[VerificationAgent] Healing attempt failed:', error);
            return [];
        }
    }
}
