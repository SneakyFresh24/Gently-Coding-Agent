type LifecycleMessage = { type: string; [key: string]: unknown };

/**
 * Enforces idempotent processing/generating lifecycle emission.
 */
export class LifecycleGuard {
  private processingActive = false;
  private generatingActive = false;

  constructor(private readonly send: (message: any) => void) {}

  dispatch(message: LifecycleMessage): void {
    switch (message.type) {
      case 'processingStart':
        this.startProcessing();
        return;
      case 'processingEnd':
        this.endProcessing();
        return;
      case 'generatingStart':
        this.startGenerating();
        return;
      case 'generatingEnd':
        this.endGenerating();
        return;
      default:
        this.send(message);
    }
  }

  startProcessing(): void {
    if (this.processingActive) return;
    this.processingActive = true;
    this.send({ type: 'processingStart' });
  }

  endProcessing(): void {
    if (!this.processingActive) return;
    this.processingActive = false;
    this.send({ type: 'processingEnd' });
  }

  startGenerating(): void {
    if (this.generatingActive) return;
    this.generatingActive = true;
    this.send({ type: 'generatingStart' });
  }

  endGenerating(): void {
    if (!this.generatingActive) return;
    this.generatingActive = false;
    this.send({ type: 'generatingEnd' });
  }

  forceFinalize(): void {
    this.endGenerating();
    this.endProcessing();
  }

  isProcessingActive(): boolean {
    return this.processingActive;
  }

  isGeneratingActive(): boolean {
    return this.generatingActive;
  }
}

