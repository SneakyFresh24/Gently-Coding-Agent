import { PlanStep, TaskStatus } from './types';

/**
 * Parses task statuses from Markdown content.
 */
export class MarkdownTaskParser {
    private static readonly STATUS_MAP: Record<string, TaskStatus> = {
        'x': 'completed',
        'X': 'completed',
        ' ': 'pending',
        '/': 'in-progress',
        '!': 'failed',
        '-': 'skipped'
    };

    /**
     * Extracts step IDs and statuses from markdown text.
     */
    public parseTaskStatuses(content: string): Map<string, TaskStatus> {
        const statusMap = new Map<string, TaskStatus>();
        
        // Match both standard GFM and our custom format:
        // - [x] **step-1**: setup project
        // - [ ] [MODIFY] **step-2**: edit file
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('- [')) continue;

            const checkboxMatch = trimmedLine.match(/- \[(.)\]/);
            const coreMatch = trimmedLine.match(/\*\*(step-\d+|\d+[a-zA-Z0-9-]*)\*\*/);

            if (checkboxMatch && coreMatch) {
                const char = checkboxMatch[1];
                const id = coreMatch[1];
                const status = MarkdownTaskParser.STATUS_MAP[char] || 'pending';
                statusMap.set(id, status);
            }
        }

        return statusMap;
    }

    /**
     * Converts a status to its corresponding checkbox character.
     */
    public getCheckboxChar(status: TaskStatus): string {
        switch (status) {
            case 'completed': return 'x';
            case 'in-progress': return '/';
            case 'failed': return '!';
            case 'skipped': return '-';
            case 'pending':
            default: return ' ';
        }
    }

    /**
     * Converts a status to its corresponding emoji.
     */
    public getStatusEmoji(status: TaskStatus): string {
        switch (status) {
            case 'completed': return '✅';
            case 'in-progress': return '🔄';
            case 'failed': return '❌';
            case 'skipped': return '⏭️';
            case 'pending': 
            default: return '⬜';
        }
    }
}
