import type { Database } from "../db";
import type { AppEnv } from "../env";
import type { WebhookAction } from "../lib/telegramWebhook";
import { applyWebhookAction } from "../lib/telegramActions";

interface UpdateRow {
  update_id: string;
  action: WebhookAction;
  attempts: number;
}

export async function acceptTelegramUpdate(
  env: AppEnv,
  updateId: number,
  action: WebhookAction,
  db: Database,
): Promise<boolean> {
  const sql = db.sql;
  const rows = await sql<{ update_id: string }[]>`
    insert into app_private.telegram_updates (update_id, action, status)
    values (${updateId}, ${sql.json(action)}, 'pending')
    on conflict (update_id) do nothing
    returning update_id
  `;
  return rows.length === 1;
}

export async function processTelegramUpdate(env: AppEnv, updateId: number, db: Database): Promise<boolean> {
  const sql = db.sql;
  const [row] = await sql<UpdateRow[]>`
    update app_private.telegram_updates
    set status = 'processing', attempts = attempts + 1, processing_started_at = now()
    where update_id = ${updateId}
      and (
        status = 'pending'
        or (status = 'processing' and processing_started_at < now() - interval '5 minutes')
      )
      and attempts < 20
    returning update_id, action, attempts
  `;
  if (!row) return true;
  try {
    await applyWebhookAction(env, row.action, db);
    await sql`
      update app_private.telegram_updates
      set status = 'processed', processed_at = now(), processing_started_at = null, last_error = null
      where update_id = ${updateId}
    `;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    await sql`
      update app_private.telegram_updates
      set status = case when attempts >= 20 then 'dead_letter' else 'pending' end,
          processing_started_at = null,
          last_error = ${message}
      where update_id = ${updateId}
    `;
    return false;
  }
}
