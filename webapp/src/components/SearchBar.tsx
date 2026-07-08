import { SEARCH_MAX } from "@agromarket/contracts";
import type { ChangeEvent } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = "Поиск по названию" }: SearchBarProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  return (
    <div className="search-bar">
      <svg className="search-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
      <input
        className="search-bar-input"
        type="search"
        inputMode="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        maxLength={SEARCH_MAX}
      />
      {value && (
        <button
          type="button"
          className="search-bar-clear"
          onClick={() => onChange("")}
          aria-label="Очистить поиск"
        >
          ✕
        </button>
      )}
    </div>
  );
}
