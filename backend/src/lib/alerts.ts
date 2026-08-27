import type { AppEnv } from "../env";
import type { Database } from "../db";
import { getAdminChatId } from "../repos/settings";
import { sendAdminNotification } from "./telegramBot";

const WINDOW_MINUTES = 5;
const DEDUP_TTL_SECONDS = 30 * 60;
const MIN_SAMPLE_FOR_RATE = 20; // ниже — доля 5xx ненадёжна, судим по абсолютному счётчику
const FIVEXX_RATE_THRESHOLD = 0.01; // см. DEPLOYMENT.md: "после релиза доля 5xx > 1%"
const FIVEXX_ABSOLUTE_FLOOR = 3;

interface WindowCounts {
  total: number;
  serverErrors: number;
  dbConnectionErrors: number;
}

interface Alert {
  key: string;
  message: string;
}

async function queryWindow(env: AppEnv): Promise<WindowCounts> {
  const sql = `
    SELECT index1 AS category, count() AS n
    FROM agromarketkz_requests
    WHERE timestamp > NOW() - INTERVAL '${WINDOW_MINUTES}' MINUTE
    GROUP BY category
  `;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
    { method: "POST", headers: { Authorization: `Bearer ${env.CF_ANALYTICS_API_TOKEN}` }, body: sql }
  );
  if (!res.ok) {
    throw new Error(`analytics_engine/sql: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: { category: string; n: number }[] };
  const byCategory = new Map((body.data ?? []).map((row) => [row.category, row.n]));
  return {
    total:
      (byCategory.get("ok") ?? 0) + (byCategory.get("client_error") ?? 0) + (byCategory.get("server_error") ?? 0),
    serverErrors: byCategory.get("server_error") ?? 0,
    dbConnectionErrors: byCategory.get("db_conn_error") ?? 0
  };
}

/** Чистая функция оценки порогов — легко тестируется таблично, без сети/KV. */
export function evaluateWindow(w: WindowCounts): Alert[] {
  const alerts: Alert[] = [];
  if (w.dbConnectionErrors > 0) {
    alerts.push({
      key: "db-conn-errors",
      message: `🔴 [ALERT] Ошибки подключения к БД: ${w.dbConnectionErrors} за последние ${WINDOW_MINUTES} мин`
    });
  }
  const rateBreach = w.total >= MIN_SAMPLE_FOR_RATE && w.serverErrors / w.total > FIVEXX_RATE_THRESHOLD;
  const absoluteBreach = w.total < MIN_SAMPLE_FOR_RATE && w.serverErrors >= FIVEXX_ABSOLUTE_FLOOR;
  if (rateBreach || absoluteBreach) {
    const pct = w.total > 0 ? ((w.serverErrors / w.total) * 100).toFixed(1) : "н/д";
    alerts.push({
      key: "5xx-rate",
      message: `⚠️ [ALERT] 5xx: ${w.serverErrors}/${w.total} (${pct}%) за последние ${WINDOW_MINUTES} мин`
    });
  }
  return alerts;
}

const alertDedupKey = (key: string) => `alert:${key}`;

async function isSuppressed(env: AppEnv, key: string): Promise<boolean> {
  if (!env.AUTH_CACHE_KV) return false;
  return (await env.AUTH_CACHE_KV.get(alertDedupKey(key))) !== null;
}

async function markSent(env: AppEnv, key: string): Promise<void> {
  if (!env.AUTH_CACHE_KV) return;
  await env.AUTH_CACHE_KV.put(alertDedupKey(key), "1", { expirationTtl: DEDUP_TTL_SECONDS }).catch(() => {});
}

/**
 * Периодическая (каждые 5 мин, cron в worker.ts) проверка здоровья БД/5xx через Workers
 * Analytics Engine — GraphQL Analytics API не видит HTTP-статусы для Worker без своего домена
 * (только *.workers.dev), поэтому счётчики пишет сам app.ts (см. REQUEST_METRICS). Без настроенных
 * REQUEST_METRICS/CF_ANALYTICS_API_TOKEN — молча no-op, не шумит.
 */
export async function runDbHealthAlertCheck(env: AppEnv, db: Database): Promise<number> {
  if (!env.REQUEST_METRICS || !env.CF_ANALYTICS_API_TOKEN) return 0;

  let window: WindowCounts;
  try {
    window = await queryWindow(env);
  } catch (err) {
    console.error("runDbHealthAlertCheck: не удалось прочитать метрики", err);
    return 0;
  }

  const chatId = await getAdminChatId(env, db);
  if (!chatId) return 0;

  let sent = 0;
  for (const alert of evaluateWindow(window)) {
    if (await isSuppressed(env, alert.key)) continue;
    await sendAdminNotification(env, chatId, alert.message);
    await markSent(env, alert.key);
    sent += 1;
  }
  return sent;
}
