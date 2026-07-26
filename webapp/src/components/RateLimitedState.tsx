import { useEffect, useState } from "react";
import {
  autoRetriesLeft,
  computeRetryDelaySeconds,
  consumeAutoRetry,
} from "../lib/rateLimitRetry";

interface RateLimitedStateProps {
  retryAfterSeconds: number | null;
  onRetry: () => void;
}

export function RateLimitedState({ retryAfterSeconds, onRetry }: RateLimitedStateProps) {
  const [hasAutoRetry] = useState(() => autoRetriesLeft() > 0);
  const [delaySeconds] = useState(() => computeRetryDelaySeconds(retryAfterSeconds));
  const [deadline] = useState(() => Date.now() + delaySeconds * 1000);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  );

  useEffect(() => {
    if (!hasAutoRetry) return;

    let completed = false;
    const interval = setInterval(() => {
      const nextSecondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(nextSecondsLeft);

      if (nextSecondsLeft === 0 && !completed) {
        completed = true;
        clearInterval(interval);
        consumeAutoRetry();
        onRetry();
      }
    }, 250);

    return () => {
      completed = true;
      clearInterval(interval);
    };
  }, [deadline, hasAutoRetry, onRetry]);

  return (
    <div className="error-state" role="status" aria-live="polite">
      <h1>Слишком много запросов</h1>
      <p>Сервер попросил подождать. Попробуем ещё раз автоматически.</p>
      {hasAutoRetry ? (
        <p className="rate-limit-countdown" aria-hidden="true">
          Повтор через {secondsLeft} с
        </p>
      ) : (
        <p>Автоматические попытки закончились.</p>
      )}
      <button type="button" className="button button-primary" onClick={onRetry}>
        Повторить сейчас
      </button>
    </div>
  );
}
