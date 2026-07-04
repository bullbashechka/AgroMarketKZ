interface SegmentedOption<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Обобщённый сегмент-переключатель (тип карточки, тип цены, вкладки статусов заявок). */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) {
  return (
    <div className="filter-seg" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={`filter-seg-item${value === opt.value ? " filter-seg-item--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
