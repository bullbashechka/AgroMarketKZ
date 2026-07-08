import { useEffect, useState } from "react";

const SHRINK_THRESHOLD = 140;

/**
 * Определяет, открыта ли экранная клавиатура, по просадке `visualViewport.height`
 * относительно максимума, увиденного с загрузки страницы. Работает и в Telegram-webview,
 * и в мобильном браузере; сбрасывается при повороте экрана. Без `visualViewport` — всегда false.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let maxHeight = vv.height;

    const handleResize = () => {
      maxHeight = Math.max(maxHeight, vv.height);
      setOpen(maxHeight - vv.height > SHRINK_THRESHOLD);
    };

    const handleOrientationChange = () => {
      maxHeight = vv.height;
      setOpen(false);
    };

    vv.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => {
      vv.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, []);

  return open;
}
