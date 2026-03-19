<script lang="ts">
  import type { GuardianEvent } from '../../stores/guardianStore';
  import { createEventDispatcher } from 'svelte';

  export let event: GuardianEvent;

  const dispatch = createEventDispatcher();

  function resolve() {
    dispatch('resolve', { id: event.id });
  }

  function ignore() {
    dispatch('ignore', { id: event.id });
  }

  $: severityClass = `severity-${event.severity}`;
  $: typeIcon = event.type === 'security' ? '🔒' : event.type === 'performance' ? '⚡' : '📋';
</script>

<div class="issue-card {severityClass}">
  <div class="header">
    <span class="icon">{typeIcon}</span>
    <span class="title">{event.title}</span>
    <span class="badge {event.severity}">{event.severity}</span>
  </div>
  
  <p class="description">{event.description}</p>
  
  <div class="footer">
    <span class="timestamp">{new Date(event.timestamp).toLocaleTimeString()}</span>
    <div class="actions">
      <button class="action-btn text" on:click={ignore}>Ignore</button>
      <button class="action-btn primary" on:click={resolve}>Resolve</button>
    </div>
  </div>
</div>

<style>
  .issue-card {
    padding: 16px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border);
    border-left: 4px solid #ccc;
    border-radius: 8px;
    margin-bottom: 12px;
    transition: all 0.2s ease;
  }

  .issue-card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    border-color: var(--vscode-focusBorder);
  }

  .severity-critical { border-left-color: #f14c4c; }
  .severity-high { border-left-color: #ffa500; }
  .severity-medium { border-left-color: #cca700; }
  .severity-low { border-left-color: #3794ff; }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .title {
    font-weight: 600;
    flex: 1;
  }

  .badge {
    font-size: 10px;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 700;
  }

  .badge.critical { background: #f14c4c; color: white; }
  .badge.high { background: #ffa500; color: black; }
  .badge.medium { background: #cca700; color: black; }
  .badge.low { background: #3794ff; color: white; }

  .description {
    font-size: 12px;
    opacity: 0.8;
    margin-bottom: 12px;
    line-height: 1.5;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .timestamp {
    font-size: 10px;
    opacity: 0.5;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    padding: 4px 12px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    border: none;
  }

  .action-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .action-btn.primary:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .action-btn.text {
    background: transparent;
    color: var(--vscode-foreground);
    opacity: 0.7;
  }

  .action-btn.text:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }
</style>
