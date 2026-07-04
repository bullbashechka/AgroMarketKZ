import type { PriceType } from "@agromarket/contracts";

const options: { value: PriceType | undefined; label: string }[] = [
  { value: undefined, label: "Все" },
  { value: "fixed", label: "С ценой" },
  { value: "on_request", label: "По запросу" }
];

interface PriceFilterProps {
  value: PriceType | undefined;
  onChange: (value: PriceType | undefined) => void;
}

/** Сегмент-переключатель фильтра по цене: все / с ценой / по запросу. */
export function PriceFilter({ value, onChange }: PriceFilterProps) {
  return (
    <div className="filter-seg" role="tablist" aria-label="Фильтр по цене">
      {options.map((opt) => (
        <button
          key={opt.label}
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
