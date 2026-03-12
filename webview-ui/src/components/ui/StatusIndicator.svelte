<script lang="ts">
  import {
    realtimeStore,
    activityLabel,
    activityLevel,
    isAnyActivity,
  } from "../../stores/realtimeStore";
</script>

{#if $isAnyActivity}
  <div
    class="status-indicator activity-{$activityLevel} glass"
    title={$activityLabel}
  >
    <div class="spinner">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
    <span class="status-text">
      {$activityLabel}
    </span>
  </div>
{/if}

<style>
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 18px;
    margin: 12px 16px;
    border-radius: 12px;
    animation: slideIn var(--transition-slow);
    font-size: 13.5px;
    transition: all var(--transition-base);
    overflow: hidden;
    max-width: calc(100% - 32px);
  }

  /* Activity Level: light (1 subsystem active) */
  .status-indicator.activity-light {
    background: linear-gradient(
      135deg,
      rgba(59, 130, 246, 0.08),
      rgba(59, 130, 246, 0.04)
    );
    border: 1px solid rgba(59, 130, 246, 0.2);
  }
  .status-indicator.activity-light .dot {
    background-color: #3b82f6;
  }
  .status-indicator.activity-light .status-text {
    color: #60a5fa;
  }

  /* Activity Level: medium (2 subsystems active) */
  .status-indicator.activity-medium {
    background: linear-gradient(
      135deg,
      rgba(245, 158, 11, 0.08),
      rgba(245, 158, 11, 0.04)
    );
    border: 1px solid rgba(245, 158, 11, 0.2);
  }
  .status-indicator.activity-medium .dot {
    background-color: #f59e0b;
  }
  .status-indicator.activity-medium .status-text {
    color: #fbbf24;
  }

  /* Activity Level: heavy (3+ subsystems active) */
  .status-indicator.activity-heavy {
    background: linear-gradient(
      135deg,
      rgba(139, 92, 246, 0.1),
      rgba(139, 92, 246, 0.05)
    );
    border: 1px solid rgba(139, 92, 246, 0.25);
  }
  .status-indicator.activity-heavy .dot {
    background-color: #8b5cf6;
    animation-duration: 0.8s !important;
  }
  .status-indicator.activity-heavy .status-text {
    color: #a78bfa;
  }

  .spinner {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .dot:nth-child(1) {
    animation-delay: 0s;
  }
  .dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  .status-text {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }

  @keyframes bounce {
    0%,
    100% {
      opacity: 0.3;
      transform: scale(0.7) translateY(0);
    }
    50% {
      opacity: 1;
      transform: scale(1.1) translateY(-2px);
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
