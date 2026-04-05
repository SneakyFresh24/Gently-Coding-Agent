import { AgentTool } from '../agentManager/AgentManager';
import { TOOL_DEFINITIONS, ToolName } from './definitions';

export class ToolRegistry {
  private tools: Map<ToolName, AgentTool> = new Map();

  /**
   * Register a new tool
   */
  register(name: ToolName, executeFn: (params: any) => Promise<any>): void {
    const definition = (TOOL_DEFINITIONS as any)[name];
    if (!definition) {
      throw new Error(`Tool definition not found for: ${name}`);
    }

    this.tools.set(name, {
      ...definition,
      execute: executeFn
    });
  }

  /**
   * Register multiple tools at once (Legacy support)
   */
  registerMany(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name as ToolName, tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name as ToolName);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name as ToolName);
  }

  /**
   * Get all registered tools
   */
  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Clear the registry
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get tools in OpenAI tool format
   */
  getFormattedTools(): any[] {
    return this.getAll().map(tool => {
      const parameters = JSON.parse(JSON.stringify(tool.parameters));
      if (parameters.type === 'object') {
        parameters.properties = {
          ...parameters.properties,
          task_progress: {
            type: 'string',
            description: 'Optional progress update summarizing what has been done and what is left (e.g. "Analyzed code, now implementing changes").'
          }
        };
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters
        }
      };
    });
  }

  /**
   * Get structured tool specs for prompt composition.
   */
  getPromptToolSpecs(toolNames?: string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    const filterSet = toolNames ? new Set(toolNames) : null;
    return this.getAll()
      .filter(tool => !filterSet || filterSet.has(tool.name))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: (tool.parameters as { properties?: Record<string, unknown> })?.properties || {}
      }));
  }

  /**
   * Get tools description string for prompts (Legacy support)
   */
  getToolsForPrompt(): string {
    return this.getAll().map(tool => {
      const params = tool.parameters as { properties?: Record<string, unknown> };
      const properties = params?.properties || {};
      return `- **${tool.name}**: ${tool.description} (Category: ${tool.category || 'general'})\n  Parameters: ${JSON.stringify(properties, null, 2)}`;
    }).join('\n\n');
  }
}
