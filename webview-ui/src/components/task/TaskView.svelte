<script lang="ts">
  import {
    taskStore,
    currentPlan,
    planDetails,
    isLoading,
    hasError,
    retryStep,
    skipStep,
    abortPlan,
    showStepResult,
  } from "../../stores/taskStore";
  import {
    ListTodo,
    CheckCircle2,
    Circle,
    XCircle,
    Clock,
    Loader2,
    Play,
    FastForward,
    Ban,
    Eye,
    AlertCircle,
  } from "lucide-svelte";

  // Svelte 5: Use store auto-subscriptions directly in templates
  // No intermediate reactive variables needed

  function getStatusIcon(status: string) {
    switch (status) {
      case "completed":
        return CheckCircle2;
      case "in-progress":
        return Loader2;
      case "failed":
        return XCircle;
      case "pending":
        return Circle;
      default:
        return Circle;
    }
  }

  function getStatusClass(status: string): string {
    switch (status) {
      case "completed":
        return "status-completed";
      case "in-progress":
        return "status-in-progress";
      case "failed":
        return "status-failed";
      case "pending":
        return "status-pending";
      default:
        return "";
    }
  }
</script>

<div class="task-view">
  {#if $isLoading}
    <div class="loading-state">
      <Loader2 class="spinning" size={32} />
      <p>Synchronizing plan status...</p>
    </div>
  {:else if $hasError}
    <div class="error-state">
      <AlertCircle size={48} class="error-icon" />
      <p class="error-title">Sync Error</p>
      <p class="error-subtitle">Could not load current execution plan.</p>
      <button class="retry-btn" on:click={() => taskStore.requestCurrentPlan()}>
        Retry Sync
      </button>
    </div>
  {:else if $taskStore.plans.length === 0}
    <div class="empty-state">
      <div class="empty-content">
        <ListTodo size={48} class="empty-icon" />
        <p class="empty-title">No Active Plans</p>
        <p class="empty-subtitle">
          When the agent creates a plan, it will appear here
        </p>
      </div>
    </div>
  {:else if $currentPlan}
    <div class="plan-container">
      <!-- Plan Header -->
      <div class="plan-header">
        <div class="plan-title">
          <ListTodo size={20} />
          <h3>{$currentPlan?.goal}</h3>
        </div>
        <div class="header-actions">
          <div class="plan-status {getStatusClass($currentPlan?.status ?? '')}">
            {$currentPlan?.status}
          </div>
          {#if $currentPlan?.status === "executing"}
            <button
              class="icon-btn abort-btn"
              on:click={() => $currentPlan && abortPlan($currentPlan.id)}
              title="Abort Plan"
            >
              <Ban size={16} />
            </button>
          {/if}
        </div>
      </div>

      <!-- Progress Bar -->
      {#if $planDetails}
        <div class="progress-section">
          <div class="progress-bar">
            <div
              class="progress-fill"
              class:has-errors={$planDetails?.hasErrors}
              style="width: {$planDetails?.percentage ?? 0}%"
            ></div>
          </div>
          <div class="progress-text">
            {$planDetails?.completed} / {$planDetails?.total} steps completed ({$planDetails?.percentage}%)
            {#if ($planDetails?.failed ?? 0) > 0}
              <span class="failed-count">({$planDetails?.failed} failed)</span>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Steps List -->
      <div class="steps-list">
        {#each $currentPlan?.steps ?? [] as step, index}
          <div class="step-item {getStatusClass(step.status)}">
            <div class="step-header">
              <div class="step-icon">
                <svelte:component
                  this={getStatusIcon(step.status)}
                  size={18}
                  class={step.status === "in-progress" ? "spinning" : ""}
                />
              </div>
              <div class="step-content">
                <div class="step-main">
                  <div>
                    <div class="step-number">Step {index + 1}</div>
                    <div class="step-description">{step.description}</div>
                    <div class="step-tool">Tool: {step.tool}</div>
                  </div>
                  <div class="step-actions">
                    {#if step.result}
                      <button
                        class="icon-btn"
                        on:click={() =>
                          $currentPlan && showStepResult($currentPlan.id, step.id, String(step.result))}
                        title="Show Result"
                      >
                        <Eye size={14} />
                      </button>
                    {/if}
                    {#if step.status === "failed" || step.status === "completed"}
                      <button
                        class="icon-btn"
                        on:click={() => $currentPlan && retryStep($currentPlan.id, step.id)}
                        title="Retry Step"
                      >
                        <Play size={14} />
                      </button>
                    {/if}
                    {#if step.status === "pending"}
                      <button
                        class="icon-btn"
                        on:click={() => $currentPlan && skipStep($currentPlan.id, step.id)}
                        title="Skip Step"
                      >
                        <FastForward size={14} />
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            </div>

            {#if step.error}
              <div class="step-error">
                <XCircle size={14} />
                <span>{step.error}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Plan Footer -->
      <div class="plan-footer">
        <div class="plan-meta">
          <Clock size={14} />
          <span>Created {new Date($currentPlan?.createdAt ?? 0).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .task-view {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.5;
  }

  .empty-content {
    text-align: center;
  }

  .empty-content :global(.empty-icon) {
    opacity: 0.3;
    margin-bottom: 1rem;
  }

  .empty-title {
    font-size: 1.125rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
  }

  .empty-subtitle {
    font-size: 0.875rem;
    opacity: 0.7;
  }

  /* Plan Container */
  .plan-container {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
    backdrop-filter: blur(10px);
  }

  .plan-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-lg);
  }

  .plan-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .plan-title h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .plan-status {
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .status-pending {
    background: rgba(156, 163, 175, 0.2);
    color: #9ca3af;
  }

  .status-in-progress {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }

  .status-completed {
    background: rgba(34, 197, 94, 0.2);
    color: var(--color-success);
  }

  .status-failed {
    background: rgba(239, 68, 68, 0.2);
    color: var(--color-error);
  }

  /* Progress Section */
  .progress-section {
    margin-bottom: 1.5rem;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin-bottom: var(--space-sm);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-primary), #8b5cf6);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: var(--font-base);
    opacity: 0.7;
    text-align: center;
  }

  /* Steps List */
  .steps-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .step-item {
    background: var(--color-surface);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    transition: all var(--transition-base);
  }

  .step-item.status-in-progress {
    border-color: var(--color-primary-border);
    background: var(--color-primary-bg);
  }

  .step-item.status-completed {
    border-color: rgba(34, 197, 94, 0.3);
    background: rgba(34, 197, 94, 0.05);
  }

  .step-item.status-failed {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.05);
  }

  .step-header {
    display: flex;
    gap: 0.75rem;
  }

  .step-icon {
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .step-icon :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .step-content {
    flex: 1;
  }

  .step-number {
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0.6;
    margin-bottom: 0.25rem;
  }

  .step-description {
    font-size: 0.9375rem;
    margin-bottom: 0.5rem;
    line-height: 1.5;
  }

  .step-tool {
    font-size: 0.8125rem;
    opacity: 0.5;
    font-family: "Courier New", monospace;
  }

  .step-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    font-size: 0.875rem;
    color: #ef4444;
  }

  /* Plan Footer */
  .plan-footer {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .plan-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    opacity: 0.6;
  }
</style>
