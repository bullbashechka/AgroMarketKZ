import { useEffect } from "react";
import { hapticNotify } from "../lib/telegram";

interface SuccessCheckProps {
  title: string;
  description?: string;
}

/** Анимация галочки в стиле подтверждения платежа + haptic + короткий звук — экран успеха заявки. */
export function SuccessCheck({ title, description }: SuccessCheckProps) {
  useEffect(() => {
    hapticNotify("success");
  }, []);

  return (
    <div className="success-check" role="status" aria-live="polite">
      <svg className="success-check-icon" viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <circle className="success-check-circle" cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="4" pathLength={1} />
        <path
          className="success-check-mark"
          d="M24 41l11 11 21-23"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          pathLength={1}
        />
      </svg>
      <p className="success-check-title">{title}</p>
      {description && <p className="success-check-description">{description}</p>}
    </div>
  );
}
