/** Человекопонятная ошибка загрузки данных с кнопкой повторить — для нестабильной связи в поле. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="error-state">
      <p className="error">{message ?? "Не удалось загрузить данные. Проверьте интернет."}</p>
      <button type="button" className="button button-primary" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}
