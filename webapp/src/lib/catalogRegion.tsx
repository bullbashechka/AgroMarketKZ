import type { CatalogRegionFilter } from "@agromarket/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";

interface CatalogRegionContextValue {
  region: CatalogRegionFilter;
  setRegion: (region: CatalogRegionFilter) => void;
}

const CatalogRegionContext = createContext<CatalogRegionContextValue | null>(null);

/** Общий фильтр территории живёт только в памяти Mini App и сбрасывается при её полной перезагрузке. */
export function CatalogRegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<CatalogRegionFilter>("all_regions");
  return (
    <CatalogRegionContext.Provider value={{ region, setRegion }}>
      {children}
    </CatalogRegionContext.Provider>
  );
}

export function useCatalogRegion(): CatalogRegionContextValue {
  const context = useContext(CatalogRegionContext);
  if (!context) throw new Error("useCatalogRegion должен использоваться внутри CatalogRegionProvider");
  return context;
}
