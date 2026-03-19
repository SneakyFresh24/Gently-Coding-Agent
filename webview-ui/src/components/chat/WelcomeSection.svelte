<script lang="ts">
</script>

<div class="welcome">
  <div class="welcome-content">
    <div class="welcome-icon">🤖</div>
    <h2 class="welcome-title">Gently</h2>
    <p class="welcome-subtitle">AI Coding Agent</p>

    <div class="welcome-tips">
      <div class="tip">
        <span class="tip-icon">💬</span>
        <span>Ask me to write, edit, or debug code</span>
      </div>
      <div class="tip">
        <span class="tip-icon">📁</span>
        <span>Attach files for context with @</span>
      </div>
      <div class="tip">
        <span class="tip-icon">🏗️</span>
        <span>Use Architect mode for complex plans</span>
      </div>
      <div class="tip">
        <span class="tip-icon">⚡</span>
        <span>Configure auto-approve for faster workflows</span>
      </div>
    </div>
  </div>
</div>

<style>
  .welcome {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3xl);
  }

  .welcome-content {
    text-align: center;
    max-width: 320px;
  }

  .welcome-icon {
    font-size: 48px;
    margin-bottom: var(--space-lg);
  }

  .welcome-title {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    color: var(--vscode-foreground);
    margin-bottom: var(--space-xs);
  }

  .welcome-subtitle {
    font-size: var(--font-size-sm);
    color: var(--vscode-descriptionForeground);
    margin-bottom: var(--space-3xl);
  }

  .welcome-tips {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    text-align: left;
  }

  .tip {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-md) var(--space-lg);
    background: var(--vscode-editor-background);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--vscode-foreground);
  }

  .tip-icon {
    font-size: var(--font-size-lg);
    flex-shrink: 0;
  }
</style>
