import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { showBackButton } from "../lib/telegram";

interface ScreenProps {
  title?: string;
  /** Второй и следующие уровни стека вкладки — показывает кнопку «назад» (on-screen + нативную TG). */
  back?: boolean;
  /** Куда вернуться, если нет истории навигации (прямой заход по ссылке). */
  fallbackTo?: string;
  children: ReactNode;
}

export function Screen({ title, back, fallbackTo, children }: ScreenProps) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();

  const goBack = () => {
    if (canGoBack) router.history.back();
    else navigate({ href: fallbackTo ?? "/" });
  };

  useEffect(() => {
    if (!back) return;
    return showBackButton(goBack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  return (
    <div className="screen">
      {(back || title) && (
        <div className="screen-header">
          {back && (
            <button type="button" className="back-button" onClick={goBack} aria-label="Назад">
              ←
            </button>
          )}
          {title && <h2 className="screen-title">{title}</h2>}
        </div>
      )}
      {children}
    </div>
  );
}
