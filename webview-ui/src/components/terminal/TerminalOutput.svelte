<script lang="ts">
  import { vscodeApi } from "../../lib/vscode";
  import { onMount } from "svelte";
  import { terminalStore } from "../../stores/terminalStore";
  import { extensionSync } from "../../lib/extensionSync";

  export let commandId: string;
  export let command: string;
  export let isRunning: boolean;
  export let exitCode: number | undefined = undefined;
  export let duration: number | undefined = undefined;

  let outputContainer: HTMLDivElement;
  let autoScroll = true;

  // Get output from store
  $: execution = $terminalStore.activeExecutions.get(commandId);
  $: outputLines = execution?.output || [];

  // Format duration
  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  // Auto-scroll to bottom
  function scrollToBottom() {
    if (autoScroll && outputContainer) {
      outputContainer.scrollTop = outputContainer.scrollHeight;
    }
  }

  // Handle scroll to detect manual scrolling
  function handleScroll() {
    if (!outputContainer) return;
    const isAtBottom =
      outputContainer.scrollHeight - outputContainer.scrollTop <=
      outputContainer.clientHeight + 50;
    autoScroll = isAtBottom;
  }

  // Kill command
  function handleKill() {
    extensionSync.send("killCommand", { commandId });
  }

  onMount(() => {
    scrollToBottom();
  });

  // Status computation
  $: statusColor = isRunning
    ? "var(--vscode-charts-blue)"
    : exitCode === 0
      ? "var(--vscode-charts-green)"
      : "var(--vscode-charts-red)";

  $: statusIcon = isRunning ? "⚡" : exitCode === 0 ? "✓" : "✕";

  $: statusText = isRunning
    ? "Läuft..."
    : exitCode === 0
      ? "Erfolgreich"
      : `Fehler (Exit Code: ${exitCode})`;
</script>

<div class="terminal-output">
  <div class="terminal-header">
    <div class="terminal-status" style="color: {statusColor}">
      <span class="status-icon">{statusIcon}</span>
      <span class="status-text">{statusText}</span>
      {#if duration !== undefined}
        <span class="status-duration">({formatDuration(duration)})</span>
      {/if}
    </div>
    <div class="terminal-command">
      <code>{command}</code>
    </div>
    {#if isRunning}
      <button class="btn-kill" on:click={handleKill} title="Cancel command">
        <span>⏹</span>
      </button>
    {/if}
  </div>

  <div
    class="terminal-body"
    bind:this={outputContainer}
    on:scroll={handleScroll}
  >
    {#if outputLines.length === 0}
      <div class="output-empty">Waiting for output...</div>
    {:else}
      {#each outputLines as line}
        <div class="output-line output-{line.type}">
          {line.text}
        </div>
      {/each}
    {/if}
  </div>

  {#if !autoScroll}
    <button class="btn-scroll-bottom" on:click={scrollToBottom}>
      ↓ Zum Ende scrollen
    </button>
  {/if}
</div>

<style>
  .terminal-output {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    margin: 12px 0;
    overflow: hidden;
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .terminal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .terminal-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .status-icon {
    font-size: 16px;
    line-height: 1;
  }

  .status-duration {
    opacity: 0.7;
    font-weight: 400;
  }

  .terminal-command {
    flex: 1;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-kill {
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--vscode-foreground);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-kill:hover {
    background: rgba(255, 0, 0, 0.2);
    border-color: rgba(255, 0, 0, 0.4);
  }

  .terminal-body {
    max-height: 400px;
    overflow-y: auto;
    padding: 12px 16px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    line-height: 1.6;
    background: rgba(0, 0, 0, 0.2);
  }

  .output-empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    text-align: center;
    padding: 20px;
  }

  .output-line {
    white-space: pre-wrap;
    word-break: break-all;
    margin-bottom: 2px;
  }

  .output-stdout {
    color: var(--vscode-editor-foreground);
  }

  .output-stderr {
    color: var(--vscode-charts-red);
  }

  .output-status {
    color: var(--vscode-charts-blue);
    font-style: italic;
  }

  .output-error {
    color: var(--vscode-charts-red);
    font-weight: 600;
  }

  .btn-scroll-bottom {
    position: absolute;
    bottom: 20px;
    right: 20px;
    padding: 8px 16px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.2s ease;
  }

  .btn-scroll-bottom:hover {
    background: var(--vscode-button-hoverBackground);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }
</style>
