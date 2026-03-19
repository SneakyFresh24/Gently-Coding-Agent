<script lang="ts">
  import { guardianStore, filteredEvents, activeEvents, criticalCount } from '../../stores/guardianStore';
  import StatsOverview from './StatsOverview.svelte';
  import IssueCard from './IssueCard.svelte';
  
  $: highCount = $activeEvents.filter(e => e.severity === 'high').length;
  $: mediumCount = $activeEvents.filter(e => e.severity === 'medium').length;
  $: totalCount = $activeEvents.length;

  function handleResolve(event: CustomEvent<{id: string}>) {
    guardianStore.updateEvent(event.detail.id, { status: 'resolved' });
  }

  function handleIgnore(event: CustomEvent<{id: string}>) {
    guardianStore.updateEvent(event.detail.id, { status: 'ignored' });
  }

  function startScan() {
    guardianStore.setScanning(true);
    // Simulate scan
    setTimeout(() => {
      guardianStore.setScanning(false);
    }, 2000);
  }
</script>

<div class="guardian-view">
  <header class="view-header">
    <div class="title-group">
      <h2>Shield Guardian</h2>
      <p class="subtitle">System Monitoring & Safety Dashboard</p>
    </div>
    <button class="scan-btn" class:scanning={$guardianStore.isScanning} on:click={startScan} disabled={$guardianStore.isScanning}>
      {$guardianStore.isScanning ? '🛡️ Scanning...' : '🔍 Start Scan'}
    </button>
  </header>

  <StatsOverview 
    critical={$criticalCount}
    high={highCount}
    medium={mediumCount}
    total={totalCount}
  />

  <div class="events-list">
    <div class="list-header">
      <h3>Active Issues</h3>
    </div>

    {#if $filteredEvents.length === 0}
      <div class="empty-state">
        <span class="icon">✅</span>
        <p>No active issues detected. System is secure.</p>
      </div>
    {:else}
      {#each $filteredEvents as event (event.id)}
        <IssueCard {event} on:resolve={handleResolve} on:ignore={handleIgnore} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .guardian-view {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
    color: var(--vscode-foreground);
  }

  .view-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
  }

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
  }

  .subtitle {
    margin: 4px 0 0;
    opacity: 0.6;
    font-size: 13px;
  }

  .scan-btn {
    padding: 8px 16px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .scan-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .scan-btn.scanning {
    opacity: 0.7;
    cursor: wait;
  }

  .list-header {
    margin-bottom: 16px;
    border-bottom: 1px solid var(--vscode-widget-border);
    padding-bottom: 8px;
  }

  h3 {
    margin: 0;
    font-size: 16px;
    opacity: 0.9;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px;
    background: var(--vscode-sideBar-background);
    border: 1px dashed var(--vscode-widget-border);
    border-radius: 12px;
    text-align: center;
    margin-top: 24px;
  }

  .empty-state .icon {
    font-size: 32px;
    margin-bottom: 12px;
  }

  .empty-state p {
    opacity: 0.7;
  }
</style>
