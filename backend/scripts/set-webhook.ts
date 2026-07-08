/**
 * Регистрация вебхука Telegram-бота.
 *
 * Использование (из каталога backend):
 *   bun run webhook:set https://<публичный-https-адрес>   — установить вебхук
 *   bun run webhook:set --delete                          — удалить вебхук
 *
 * URL вебхука = <база>/telegram/webhook (в dev база — туннель webapp: vite
 * проксирует /telegram на backend). Требует TELEGRAM_BOT_TOKEN и
 * TELEGRAM_WEBHOOK_SECRET в окружении (подхватываются из корневого .env).
 * После каждой смены адреса туннеля скрипт нужно запускать заново.
 */

const token = Bun.env.TELEGRAM_BOT_TOKEN;
const secret = Bun.env.TELEGRAM_WEBHOOK_SECRET;
const arg = Bun.argv[2];

if (!token) {
  console.error("Не задан TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

async function callApi(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`${method}: ошибка Telegram API`, JSON.stringify(json));
    process.exit(1);
  }
  return json;
}

if (arg === "--delete") {
  console.log("deleteWebhook:", JSON.stringify(await callApi("deleteWebhook")));
} else {
  if (!arg || !arg.startsWith("https://")) {
    console.error("Укажите публичный https-адрес: bun run webhook:set https://<tunnel>");
    process.exit(1);
  }
  if (!secret) {
    console.error("Не задан TELEGRAM_WEBHOOK_SECRET (нужен для защиты вебхука)");
    process.exit(1);
  }
  const url = `${arg.replace(/\/$/, "")}/telegram/webhook`;
  const result = await callApi("setWebhook", {
    url,
    secret_token: secret,
    // Только нужные типы апдейтов: сообщения (личка, migrate) и членство бота в чатах.
    allowed_updates: ["message", "my_chat_member"]
  });
  console.log("setWebhook:", JSON.stringify(result));
}

console.log("getWebhookInfo:", JSON.stringify(await callApi("getWebhookInfo")));
