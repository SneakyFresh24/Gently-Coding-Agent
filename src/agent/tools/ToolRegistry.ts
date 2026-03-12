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
    return this.getAll().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Get tools description string for prompts (Legacy support)
   */
  getToolsForPrompt(): string {
    return this.getAll().map(tool => {
      const params = tool.parameters as any;
      const properties = params?.properties || {};
      return `- **${tool.name}**: ${tool.description} (Category: ${tool.category || 'general'})\n  Parameters: ${JSON.stringify(properties, null, 2)}`;
    }).join('\n\n');
  }
}