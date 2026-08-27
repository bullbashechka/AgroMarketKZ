import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST_DIR = join(import.meta.dir, "..");
const MANIFEST_PATH = join(DIST_DIR, "dist", ".vite", "manifest.json");
export const MAX_INITIAL_JAVASCRIPT_BYTES = 473_807;
const FORBIDDEN_INITIAL_SOURCES = ["src/screens/admin/", "src/screens/CardEditorScreen.tsx"];
export const REQUIRED_LAZY_SOURCES = [
  "src/screens/ProfileEditScreen.tsx",
  "src/screens/FavoritesScreen.tsx",
  "src/screens/FeedbackScreen.tsx",
  "src/screens/admin/AdminCardsScreen.tsx",
  "src/screens/admin/CardEditorScreen.tsx",
  "src/screens/admin/AdminCategoriesScreen.tsx",
  "src/screens/admin/AdminRequestsScreen.tsx",
  "src/screens/admin/AdminRequestScreen.tsx",
  "src/screens/admin/AdminUsersScreen.tsx",
  "src/screens/admin/AdminSettingsScreen.tsx",
];

type ManifestEntry = {
  css?: string[];
  dynamicImports?: string[];
  file: string;
  imports?: string[];
  isEntry?: boolean;
  src?: string;
};

type Manifest = Record<string, ManifestEntry>;

export type ChunkSize = {
  file: string;
  gzipBytes: number;
  rawBytes: number;
  source: string;
};

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

export function collectInitialEntries(manifest: Manifest) {
  const entryKey = Object.entries(manifest).find(([, entry]) => entry.isEntry)?.[0];
  if (!entryKey) {
    throw new Error("Vite manifest does not contain an initial entry.");
  }

  const initialEntries = new Set<string>();
  const visit = (key: string) => {
    if (initialEntries.has(key)) return;

    const entry = manifest[key];
    if (!entry) {
      throw new Error(`Vite manifest references missing chunk: ${key}`);
    }

    initialEntries.add(key);
    entry.imports?.forEach(visit);
  };

  visit(entryKey);
  return initialEntries;
}

export function validateBundleContract({
  chunks,
  dynamicImports,
}: {
  chunks: ChunkSize[];
  dynamicImports: string[];
}) {
  const rawBytes = chunks.reduce((total, chunk) => total + chunk.rawBytes, 0);
  const forbiddenSources = chunks
    .map((chunk) => chunk.source)
    .filter((source) => FORBIDDEN_INITIAL_SOURCES.some((forbidden) => source.includes(forbidden)));
  const missingLazySources = REQUIRED_LAZY_SOURCES.filter((source) => !dynamicImports.includes(source));

  if (rawBytes > MAX_INITIAL_JAVASCRIPT_BYTES) {
    throw new Error(`Initial JavaScript exceeds budget by ${formatBytes(rawBytes - MAX_INITIAL_JAVASCRIPT_BYTES)}.`);
  }
  if (forbiddenSources.length > 0) {
    throw new Error(`Admin/editor sources are present in the initial graph: ${forbiddenSources.join(", ")}`);
  }
  if (missingLazySources.length > 0) {
    throw new Error(`Expected lazy routes are no longer dynamic imports: ${missingLazySources.join(", ")}`);
  }
}

export async function checkBundle(manifestPath = MANIFEST_PATH) {
  const manifest = (await Bun.file(manifestPath).json()) as Manifest;
  const distDir = join(manifestPath, "..", "..");
  const initialEntries = collectInitialEntries(manifest);
  const chunks = await Promise.all(
    [...initialEntries].map(async (key) => {
      const entry = manifest[key];
      const bytes = new Uint8Array(await Bun.file(join(distDir, entry.file)).arrayBuffer());

      return {
        file: entry.file,
        gzipBytes: gzipSync(bytes).byteLength,
        rawBytes: bytes.byteLength,
        source: entry.src ?? key,
      } satisfies ChunkSize;
    })
  );
  const gzipBytes = chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0);
  const entryKey = Object.entries(manifest).find(([, entry]) => entry.isEntry)?.[0];
  const dynamicImports = entryKey ? manifest[entryKey].dynamicImports ?? [] : [];
  const rawBytes = chunks.reduce((total, chunk) => total + chunk.rawBytes, 0);

  console.log(`Initial JavaScript: ${formatBytes(rawBytes)} raw / ${formatBytes(gzipBytes)} gzip`);
  console.log(`Budget: ${formatBytes(MAX_INITIAL_JAVASCRIPT_BYTES)} raw`);
  console.log("Largest initial chunks:");
  for (const chunk of [...chunks].sort((a, b) => b.rawBytes - a.rawBytes).slice(0, 5)) {
    console.log(`- ${chunk.file}: ${formatBytes(chunk.rawBytes)} raw / ${formatBytes(chunk.gzipBytes)} gzip (${chunk.source})`);
  }

  validateBundleContract({ chunks, dynamicImports });
}

if (import.meta.main) {
  await checkBundle();
}
