export const MAX_AUTO_RETRIES = 3;
export const RETRY_JITTER_SECONDS = 30;

let usedAutoRetries = 0;

export function autoRetriesLeft(): number {
  return Math.max(0, MAX_AUTO_RETRIES - usedAutoRetries);
}

export function consumeAutoRetry(): void {
  usedAutoRetries = Math.min(MAX_AUTO_RETRIES, usedAutoRetries + 1);
}

export function resetAutoRetries(): void {
  usedAutoRetries = 0;
}

export function computeRetryDelaySeconds(
  retryAfterSeconds: number | null,
  random: () => number = Math.random,
): number {
  const requestedDelay =
    retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds
      : 60;
  const baseDelay = Math.min(300, Math.max(1, requestedDelay));
  return baseDelay + Math.floor(random() * (RETRY_JITTER_SECONDS + 1));
}
