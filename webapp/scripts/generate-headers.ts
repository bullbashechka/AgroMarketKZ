/**
 * Генерирует webapp/dist/_headers после `vite build`.
 *
 * API всегда проходит через same-origin Pages Function (/api), поэтому в CSP
 * остаётся только внешний Supabase origin для прямой signed-загрузки.
 *
 * Требует SUPABASE_URL непустым и парсящимся как URL.
 *
 * CSP enforcing включён по умолчанию. CSP_REPORT_ONLY=1 — временный opt-in
 * для controlled debugging.
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

const supabaseOrigin = requireOrigin("SUPABASE_URL");
const cspHeaderName =
  Bun.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

const csp = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self'",
  `connect-src 'self' ${supabaseOrigin}`,
  `img-src 'self' data: blob: ${supabaseOrigin}`,
  "frame-src https://oauth.telegram.org",
  "frame-ancestors https://web.telegram.org https://*.telegram.org",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const headers = `/*
  ${cspHeaderName}: ${csp}
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
`;

await Bun.write("dist/_headers", headers);
console.log(`dist/_headers записан (${cspHeaderName}, API=same-origin, Supabase=${supabaseOrigin})`);
