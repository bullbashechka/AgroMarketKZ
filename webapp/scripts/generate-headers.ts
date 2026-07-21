/**
 * Генерирует webapp/dist/_headers после `vite build`.
 *
 * CSP должна содержать точные origin API и Supabase, а не 'self'/wildcard —
 * они известны только на момент сборки (production Worker origin появится
 * после первого деплоя, Этап 10), поэтому статический public/_headers не подходит.
 *
 * Требует VITE_API_URL и SUPABASE_URL непустыми и парсящимися как URL. Пустая
 * строка (в т.ч. осознанная VITE_API_URL= для dev-туннеля с proxy — см.
 * webapp/README.md) для билда недопустима: паданьем здесь мы не даём
 * `bun run build` молча опубликовать бандл с localhost/пустым API origin.
 *
 * CSP по умолчанию Content-Security-Policy-Report-Only; CSP_ENFORCE=1
 * переключает на enforcing — делать только после ручного QA в задеплоенном
 * Telegram Web/Mini App/Login Widget/PhotoSwipe/direct upload.
 */

function requireOrigin(varName: string): string {
  const value = Bun.env[varName];
  if (!value) {
    console.error(`Не задан ${varName} — обязателен для сборки production/preview`);
    process.exit(1);
  }
  try {
    return new URL(value).origin;
  } catch {
    console.error(`${varName}=${value} не является корректным URL`);
    process.exit(1);
  }
}

const apiOrigin = requireOrigin("VITE_API_URL");
const supabaseOrigin = requireOrigin("SUPABASE_URL");
const cspHeaderName =
  Bun.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const csp = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self'",
  `connect-src 'self' ${apiOrigin} ${supabaseOrigin}`,
  `img-src 'self' data: blob: ${supabaseOrigin}`,
  "frame-src https://oauth.telegram.org",
  "frame-ancestors https://web.telegram.org https://*.telegram.org",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const headers = `/*
  ${cspHeaderName}: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
`;

await Bun.write("dist/_headers", headers);
console.log(`dist/_headers записан (${cspHeaderName}, API=${apiOrigin}, Supabase=${supabaseOrigin})`);
