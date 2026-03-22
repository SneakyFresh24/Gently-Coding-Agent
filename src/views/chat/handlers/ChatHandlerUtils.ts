import { LogService } from '../../../services/LogService';
import { ToolCallUtils } from '../utils/ToolCallUtils';

const log = new LogService('ChatHandlerUtils');

export class ChatHandlerUtils {
    /**
     * Filters tool messages based on the current mode (e.g. Architect mode restrictions).
     */
    static filterToolMessagesForMode(messages: any[], mode: string): any[] {
        if (!mode || mode !== 'architect') return messages;

        log.info('Filtering tool messages for Architect mode');
        const allowedTools = [
            'find_files', 'list_files', 'get_memories', 'recall_memories',
            'read_file', 'analyze_project_structure',
            'create_plan', 'handover_to_coder',
            'update_memory_bank', 'query_long_term_memory'
        ];

        return messages.filter(msg => {
            const content = msg.content;
            if (content.includes('planCreated') || content.includes('Plan created with') || content.includes('phase":"created')) {
                return true;
            }
            return allowedTools.some(tool =>
                content.includes(`"name":"${tool}"`) ||
                content.includes(`tool_name":"${tool}"`) ||
                content.includes(`"tool":"${tool}"`)
            );
        });
    }

    /**
     * Repairs and validates tool calls using existing utilities.
     */
    static repairAndValidate(toolCalls: any[], model?: string): { validToolCalls: any[], invalidToolCalls: any[], warnings: string[] } {
        return ToolCallUtils.validateAndRepairToolCalls(toolCalls, { model });
    }

    /**
     * Repairs conversation history by removing orphaned tool messages.
     */
    static repairConversationHistory(history: any[]): any[] | null {
        try {
            const toolCallIds = new Set<string>();
            history.forEach(msg => {
                if (msg.role === 'assistant' && msg.tool_calls) {
                    msg.tool_calls.forEach((tc: any) => toolCallIds.add(tc.id));
                }
            });

            return history.filter(msg => {
                if (msg.role === 'tool' && msg.tool_call_id) {
                    return toolCallIds.has(msg.tool_call_id);
                }
                return true;
            });
        } catch (error) {
            log.error('Error repairing history:', error);
            return null;
        }
    }
}
