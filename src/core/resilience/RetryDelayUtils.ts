export async function sleepWithAbort(
  delayMs: number,
  shouldAbort?: () => boolean,
  stepMs = 100
): Promise<boolean> {
  const targetDelay = Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0;
  if (targetDelay <= 0) {
    return false;
  }

  const safeStep = Number.isFinite(stepMs) ? Math.max(20, Math.floor(stepMs)) : 100;
  let elapsed = 0;

  while (elapsed < targetDelay) {
    if (shouldAbort?.()) {
      return true;
    }
    const wait = Math.min(safeStep, targetDelay - elapsed);
    await new Promise((resolve) => setTimeout(resolve, wait));
    elapsed += wait;
  }

  return shouldAbort?.() === true;
}

