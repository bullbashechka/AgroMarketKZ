import type { AppEnv } from "../env";
import type { Database } from "../db";
import { sendTelegramMessage, sendTelegramPhoto, type InlineKeyboardMarkup } from "./telegramBot";
import type { WebhookAction } from "./telegramWebhook";
import { getAdminChatId, updateSettings } from "../repos/settings";

const WELCOME_CAPTION = [
  "<b>Добро пожаловать в AgroMarketKZ!</b>",
  "Здесь вы найдёте сельхозтовары, технику и услуги.",
  "",
  "Нажмите кнопку ниже, чтобы открыть каталог, выбрать объявление и связаться с продавцом."
].join("\n");

function buildAppButton(env: AppEnv): InlineKeyboardMarkup | null {
  if (!env.TELEGRAM_BOT_USERNAME || !env.TELEGRAM_MINIAPP_SHORTNAME) return null;
  return {
    inline_keyboard: [[{
      text: "Открыть AgroMarket",
      url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_MINIAPP_SHORTNAME}`
    }]]
  };
}

function buildWelcomeBannerUrl(env: AppEnv): string | null {
  try {
    const origin = new URL(env.WEBAPP_ORIGIN);
    return origin.protocol === "https:" ? new URL("/welcome-banner.png", origin).toString() : null;
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

export async function applyWebhookAction(env: AppEnv, action: WebhookAction, db: Database): Promise<void> {
  switch (action.type) {
    case "save_chat": {
      const current = await getAdminChatId(env, db);
      if (current && current !== String(action.chatId)) {
        await sendTelegramMessage(
          env,
          String(action.chatId),
          "Уведомления уже подключены к другому чату. Смена требует подтверждения владельца."
        );
        return;
      }
      await updateSettings(env, { adminChatId: String(action.chatId) }, db);
      await sendTelegramMessage(env, String(action.chatId), "Уведомления подключены.");
      return;
    }
    case "clear_chat": {
      if (await getAdminChatId(env, db) === String(action.chatId)) {
        await updateSettings(env, { adminChatId: null }, db);
      }
      return;
    }
    case "migrate_chat": {
      if (await getAdminChatId(env, db) === String(action.fromChatId)) {
        await updateSettings(env, { adminChatId: String(action.toChatId) }, db);
      }
      return;
    }
    case "greet":
      await sendWelcomeMessage(env, String(action.chatId));
      return;
    case "ignore":
      return;
  }
}
