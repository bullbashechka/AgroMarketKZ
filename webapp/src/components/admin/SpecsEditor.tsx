import { MAX_SPECS, SPEC_KEY_MAX, SPEC_VALUE_MAX } from "@agromarket/contracts";

export interface SpecRow {
  localId: string;
  key: string;
  value: string;
}

interface SpecsEditorProps {
  specs: SpecRow[];
  onChange: (specs: SpecRow[]) => void;
  errors: Record<string, string>;
}

/** Характеристики «ключ — значение»: добавление/удаление строк, лимит MAX_SPECS. */
export function SpecsEditor({ specs, onChange, errors }: SpecsEditorProps) {
  function updateRow(localId: string, patch: Partial<SpecRow>) {
    onChange(specs.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }

  function removeRow(localId: string) {
    onChange(specs.filter((row) => row.localId !== localId));
  }

  function addRow() {
    onChange([...specs, { localId: crypto.randomUUID(), key: "", value: "" }]);
  }

  return (
    <div className="field">
      <span className="field-label">Характеристики</span>
      {specs.map((row, idx) => (
        <div key={row.localId} className="spec-row">
          <input
            className="input"
            value={row.key}
            onChange={(e) => updateRow(row.localId, { key: e.target.value })}
            maxLength={SPEC_KEY_MAX}
            placeholder="Например, Мощность"
          />
          <input
            className="input"
            value={row.value}
            onChange={(e) => updateRow(row.localId, { value: e.target.value })}
            maxLength={SPEC_VALUE_MAX}
            placeholder="Например, 82 л.с."
          />
          <button
            type="button"
            className="spec-row-remove"
            onClick={() => removeRow(row.localId)}
            aria-label="Удалить характеристику"
          >
            ×
          </button>
          {(errors[`specs.${idx}.key`] || errors[`specs.${idx}.value`]) && (
            <span className="field-error spec-row-error">
              {errors[`specs.${idx}.key`] ?? errors[`specs.${idx}.value`]}
            </span>
          )}
        </div>
      ))}
      {errors.specs && <span className="field-error">{errors.specs}</span>}
      {specs.length < MAX_SPECS && (
        <button type="button" className="button button-secondary" onClick={addRow}>
          + Добавить характеристику
        </button>
      )}
    </div>
  );
}
