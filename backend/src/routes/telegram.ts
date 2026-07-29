import { Hono } from "hono";
import { getEnv, type AppEnv, type HonoEnv } from "../env";
import { parseAllowlist } from "../lib/admin";
import { HttpError } from "../lib/errors";
import { timingSafeEqual } from "../lib/telegram";
import { sendTelegramMessage, sendTelegramPhoto, type InlineKeyboardMarkup } from "../lib/telegramBot";
import { classifyUpdate, type WebhookAction } from "../lib/telegramWebhook";
import { getAdminChatId, updateSettings } from "../repos/settings";

export const telegramRoutes = new Hono<HonoEnv>();

const WELCOME_CAPTION = [
  "<b>Добро пожаловать в AgroMarketKZ!</b>",
  "Здесь вы найдёте сельхозтовары, технику и услуги.",
  "",
  "Нажмите кнопку ниже, чтобы открыть каталог, выбрать объявление и связаться с продавцом."
].join("\n");

/** Кнопка запуска Mini App для приветствия в личке (null — env не настроен). */
function buildAppButton(env: AppEnv): InlineKeyboardMarkup | null {
  if (!env.TELEGRAM_BOT_USERNAME || !env.TELEGRAM_MINIAPP_SHORTNAME) return null;
  return {
    inline_keyboard: [
      [
        {
          text: "Открыть AgroMarket",
          url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_MINIAPP_SHORTNAME}`
        }
      ]
    ]
  };
}

/** URL приветственного баннера в статических файлах webapp. */
function buildWelcomeBannerUrl(env: AppEnv): string | null {
  try {
    const origin = new URL(env.WEBAPP_ORIGIN);
    if (origin.protocol !== "https:") return null;
    return new URL("/welcome-banner.png", origin).toString();
  } catch {
    return null;
  }
}

async function sendWelcomeMessage(env: AppEnv, chatId: string): Promise<void> {
  const button = buildAppButton(env) ?? undefined;
  const bannerUrl = buildWelcomeBannerUrl(env);

  if (bannerUrl && (await sendTelegramPhoto(env, chatId, bannerUrl, WELCOME_CAPTION, button))) return;

  await sendTelegramMessage(env, chatId, WELCOME_CAPTION, button);
}

/** Выполняет действие по апдейту. Ошибки здесь ловит вызывающий код вебхука. */
async function applyWebhookAction(env: AppEnv, action: WebhookAction): Promise<void> {
  switch (action.type) {
    case "save_chat": {
      await updateSettings(env, { adminChatId: String(action.chatId) });
      await sendTelegramMessage(
        env,
        String(action.chatId),
        "Уведомления подключены. Новые заявки и сообщения обратной связи будут приходить в этот чат."
      );
      return;
    }
    case "clear_chat": {
      // Сбрасываем только если удалили из подключённого чата — не трогаем вручную заданный.
      const current = await getAdminChatId(env);
      if (current === String(action.chatId)) {
        await updateSettings(env, { adminChatId: null });
      }
      return;
    }
    case "migrate_chat": {
      const current = await getAdminChatId(env);
      if (current === String(action.fromChatId)) {
        await updateSettings(env, { adminChatId: String(action.toChatId) });
      }
      return;
    }
    case "greet": {
      await sendWelcomeMessage(env, String(action.chatId));
      return;
    }
    case "ignore":
      return;
  }
}

/**
 * Вебхук Telegram Bot API. Аутентификация — заголовок
 * `X-Telegram-Bot-Api-Secret-Token` (secret_token из setWebhook). Отвечаем 200
 * на любой валидный по секрету апдейт, даже если обработка упала, — иначе
 * Telegram будет бесконечно повторять доставку.
 */
telegramRoutes.post("/webhook", async (c) => {
  const env = getEnv(c);
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    throw new HttpError(401, "Неверный секрет вебхука");
  }

  const update = await c.req.json().catch(() => null);
  const action = classifyUpdate(update, parseAllowlist(env));

  try {
    await applyWebhookAction(env, action);
  } catch (err) {
    console.error("telegram webhook: ошибка обработки апдейта", err);
  }

  return c.json({ ok: true });
});
