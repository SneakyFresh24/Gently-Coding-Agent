<script lang="ts">
  import type { Message, QuestionCardState } from '../../lib/types';
  import { messaging } from '../../lib/messaging';

  let {
    message,
  }: {
    message: Message;
  } = $props();

  const card = $derived((message.questionCard || null) as QuestionCardState | null);
  let selectedOptionIndexes = $state<number[]>([]);
  let responded = $state(false);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let lastSubmissionKey = $state<string | null>(null);
  let lastSubmissionAt = $state(0);

  $effect(() => {
    if (!card) return;
    const incomingSelection = Array.isArray(card.selectedOptionIndexes) && card.selectedOptionIndexes.length > 0
      ? card.selectedOptionIndexes
      : [Math.max(0, Number(card.defaultOptionIndex || 0))];
    selectedOptionIndexes = [...incomingSelection];
    responded = card.status !== 'pending';
    if (card.status !== 'pending') {
      submitting = false;
      submitError = null;
    }
  });

  function selectSingle(index: number) {
    selectedOptionIndexes = [index];
  }

  function toggleMultiple(index: number) {
    if (selectedOptionIndexes.includes(index)) {
      selectedOptionIndexes = selectedOptionIndexes.filter((value) => value !== index);
      return;
    }
    selectedOptionIndexes = [...selectedOptionIndexes, index].sort((a, b) => a - b);
  }

  function submitSelection() {
    if (!card || responded || card.status !== 'pending' || submitting) return;
    if (selectedOptionIndexes.length === 0) return;
    submitError = null;

    const plainSelection = Array.from(selectedOptionIndexes)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0);
    const submissionKey = `user:${card.questionId}:${JSON.stringify(plainSelection)}`;
    const now = Date.now();
    if (lastSubmissionKey === submissionKey && (now - lastSubmissionAt) < 1500) {
      return;
    }

    submitting = true;
    const sent = messaging.send('questionResponse', {
      questionId: card.questionId,
      selectedOptionIndexes: plainSelection,
      source: 'user'
    });
    if (!sent) {
      submitting = false;
      submitError = 'Antwort konnte nicht gesendet werden. Bitte erneut versuchen.';
      return;
    }

    lastSubmissionKey = submissionKey;
    lastSubmissionAt = now;
    submitting = false;
  }

  function cancelQuestion() {
    if (!card || responded || card.status !== 'pending' || submitting) return;
    submitError = null;
    const submissionKey = `stopped:${card.questionId}`;
    const now = Date.now();
    if (lastSubmissionKey === submissionKey && (now - lastSubmissionAt) < 1500) {
      return;
    }

    submitting = true;
    const sent = messaging.send('questionResponse', {
      questionId: card.questionId,
      selectedOptionIndexes: [],
      source: 'stopped'
    });
    if (!sent) {
      submitting = false;
      submitError = 'Abbruch konnte nicht gesendet werden. Bitte erneut versuchen.';
      return;
    }

    lastSubmissionKey = submissionKey;
    lastSubmissionAt = now;
    submitting = false;
  }

  function getResolutionLabel(source?: string): string {
    switch (source) {
      case 'timeout_default':
        return 'Auto-selected default option after timeout.';
      case 'stopped':
        return 'Question stopped.';
      default:
        return 'Answered by user.';
    }
  }

  function getSelectedLabels(cardState: QuestionCardState): string {
    if (!Array.isArray(cardState.selectedOptionIndexes) || cardState.selectedOptionIndexes.length === 0) {
      return '(none)';
    }
    const labels = cardState.selectedOptionIndexes
      .map((index) => cardState.options[index]?.label)
      .filter((label) => typeof label === 'string' && label.length > 0);
    return labels.length > 0 ? labels.join(', ') : '(none)';
  }
</script>

{#if card}
  <div class="question-card" data-status={card.status}>
    <div class="question-card-header">
      <span class="question-chip">Question</span>
      {#if card.header}
        <span class="question-header">{card.header}</span>
      {/if}
    </div>
    <div class="question-text">{card.question}</div>

    <div class="question-options">
      {#each card.options as option, index}
        <label class="question-option">
          {#if card.multiple}
            <input
              type="checkbox"
              checked={card.status === 'pending' ? selectedOptionIndexes.includes(index) : card.selectedOptionIndexes.includes(index)}
              disabled={card.status !== 'pending' || responded || submitting}
              onchange={() => toggleMultiple(index)}
            />
          {:else}
            <input
              type="radio"
              name={card.questionId}
              checked={card.status === 'pending' ? selectedOptionIndexes.includes(index) : card.selectedOptionIndexes.includes(index)}
              disabled={card.status !== 'pending' || responded || submitting}
              onchange={() => selectSingle(index)}
            />
          {/if}
          <span class="option-label">{option.label}</span>
          {#if option.description}
            <span class="option-description">{option.description}</span>
          {/if}
        </label>
      {/each}
    </div>

    {#if card.status === 'pending'}
      <div class="question-actions">
        <button class="btn ghost" onclick={cancelQuestion} disabled={responded || submitting}>Cancel</button>
        <button class="btn primary" onclick={submitSelection} disabled={responded || submitting || selectedOptionIndexes.length === 0}>Submit</button>
      </div>
      {#if submitting}
        <div class="question-hint">Submitting response...</div>
      {:else}
        <div class="question-hint">Auto-default in {Math.ceil(card.timeoutMs / 1000)}s if unanswered.</div>
      {/if}
      {#if submitError}
        <div class="question-error">{submitError}</div>
      {/if}
    {:else}
      <div class="question-result">
        <div>{getResolutionLabel(card.resolutionSource)}</div>
        <div class="result-selection">Selected: {getSelectedLabels(card)}</div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .question-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-editor-background);
    padding: 12px;
    display: grid;
    gap: 10px;
  }

  .question-card[data-status='resolved'] {
    opacity: 0.92;
  }

  .question-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .question-chip {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--vscode-textLink-foreground);
  }

  .question-header {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .question-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground);
    white-space: pre-wrap;
  }

  .question-options {
    display: grid;
    gap: 8px;
  }

  .question-option {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 10px;
    align-items: start;
    padding: 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-sideBar-background);
  }

  .option-label {
    font-size: 12px;
    color: var(--vscode-foreground);
  }

  .option-description {
    grid-column: 2 / 3;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.35;
  }

  .question-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .btn.ghost {
    background: transparent;
    color: var(--vscode-foreground);
  }

  .btn.ghost:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .question-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .question-result {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    display: grid;
    gap: 4px;
  }

  .question-error {
    font-size: 11px;
    color: var(--vscode-errorForeground);
  }

  .result-selection {
    color: var(--vscode-foreground);
  }
</style>
