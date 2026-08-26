import type {
  AdminPlatformSettings,
  ContactCapabilities,
  PlatformSettings,
  UpdateSettingsInput,
} from "@agromarket/contracts";
import type { Database } from "../db";
import type { AppEnv } from "../env";
import { appendAdminAuditIntent, type AdminAuditInput } from "./adminAudit";

export interface SettingsRow {
  id: number;
  contact_phone: string | null;
  whatsapp_phone: string | null;
  telegram_contact: string | null;
  email: string | null;
  admin_chat_id: string | null;
}

function toPlatformSettings(row: SettingsRow | undefined): PlatformSettings {
  return {
    contactPhone: row?.contact_phone ?? null,
    whatsappPhone: row?.whatsapp_phone ?? null,
    telegramContact: row?.telegram_contact ?? null,
    email: row?.email ?? null
  };
}

function toAdminPlatformSettings(row: SettingsRow | undefined): AdminPlatformSettings {
  return {
    ...toPlatformSettings(row),
    adminChatId: row?.admin_chat_id ?? null
  };
}

async function getSettingsRow(env: AppEnv, db: Database): Promise<SettingsRow | undefined> {
  const sql = db.sql;
  const [row] = await sql<SettingsRow[]>`select * from platform_settings where id = 1`;
  return row;
}

/** Публичные контакты площадки. Доступны без авторизации — нужны в браузере до входа. */
export async function getSettings(env: AppEnv, db: Database): Promise<PlatformSettings> {
  return toPlatformSettings(await getSettingsRow(env, db));
}

export async function getContactCapabilities(env: AppEnv, db: Database): Promise<ContactCapabilities> {
  const row = await getSettingsRow(env, db);
  return {
    phone: Boolean(row?.contact_phone),
    whatsapp: Boolean(row?.whatsapp_phone),
    telegram: Boolean(row?.telegram_contact),
    email: Boolean(row?.email),
  };
}

/** Настройки площадки для админа (включает `adminChatId`). */
export async function getAdminSettings(env: AppEnv, db: Database): Promise<AdminPlatformSettings> {
  return toAdminPlatformSettings(await getSettingsRow(env, db));
}

/** Чат для Telegram-уведомлений о заявках/обратной связи, если задан. */
export async function getAdminChatId(env: AppEnv, db: Database): Promise<string | null> {
  const row = await getSettingsRow(env, db);
  return row?.admin_chat_id ?? null;
}

/**
 * Обновляет только переданные поля (upsert строки `id = 1`). Непереданные поля
 * не трогаются; `null` явно очищает значение.
 */
export async function updateSettings(
  env: AppEnv,
  patch: UpdateSettingsInput,
  db: Database,
  audit?: AdminAuditInput,
): Promise<AdminPlatformSettings> {
  const columns: Record<string, string | null> = {};
  if ("contactPhone" in patch) columns.contact_phone = patch.contactPhone ?? null;
  if ("whatsappPhone" in patch) columns.whatsapp_phone = patch.whatsappPhone ?? null;
  if ("telegramContact" in patch) columns.telegram_contact = patch.telegramContact ?? null;
  if ("email" in patch) columns.email = patch.email ?? null;
  if ("adminChatId" in patch) columns.admin_chat_id = patch.adminChatId ?? null;

  const keys = Object.keys(columns);
  if (keys.length === 0) {
    if (!audit) return getAdminSettings(env, db);
    return db.sql.begin(async (tx) => {
      const [row] = await tx<SettingsRow[]>`select * from platform_settings where id = 1`;
      await appendAdminAuditIntent(tx, audit);
      return toAdminPlatformSettings(row);
    });
  }

  const sql = db.sql;
  return sql.begin(async (tx) => {
    const [row] = await tx<SettingsRow[]>`
      insert into platform_settings (id, contact_phone, whatsapp_phone, telegram_contact, email, admin_chat_id)
      values (
        1,
        ${columns.contact_phone ?? null},
        ${columns.whatsapp_phone ?? null},
        ${columns.telegram_contact ?? null},
        ${columns.email ?? null},
        ${columns.admin_chat_id ?? null}
      )
      on conflict (id) do update set ${tx(columns, ...keys)}
      returning *
    `;
    if (audit) await appendAdminAuditIntent(tx, audit);
    return toAdminPlatformSettings(row);
  });
}
