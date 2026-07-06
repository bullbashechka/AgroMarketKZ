/**
 * Классификация Telegram-апдейтов вебхука. Типы описаны локально и минимально
 * (webapp их не видит, форму задаёт Bot API); все поля опциональны — незнакомые
 * или неполные апдейты безопасно сводятся к `ignore`.
 */

interface TelegramChat {
  id?: number;
  type?: string; // "private" | "group" | "supergroup" | "channel"
}

interface TelegramChatMember {
  status?: string; // "member" | "administrator" | "left" | "kicked" | ...
}

interface TelegramUpdate {
  message?: {
    chat?: TelegramChat;
    migrate_to_chat_id?: number;
  };
  my_chat_member?: {
    chat?: TelegramChat;
    from?: { id?: number };
    old_chat_member?: TelegramChatMember;
    new_chat_member?: TelegramChatMember;
  };
}

export type WebhookAction =
  | { type: "save_chat"; chatId: number } // бот добавлен админом в группу — подключить уведомления
  | { type: "clear_chat"; chatId: number } // бот удалён из чата — отключить, если чат был подключён
  | { type: "migrate_chat"; fromChatId: number; toChatId: number } // группа стала супергруппой
  | { type: "greet"; chatId: number } // личное сообщение — ответить приветствием
  | { type: "ignore" };

const GROUP_TYPES = new Set(["group", "supergroup"]);
const IN_CHAT_STATUSES = new Set(["member", "administrator", "restricted"]);
const OUT_OF_CHAT_STATUSES = new Set(["left", "kicked"]);

/**
 * Решает, что делать с апдейтом. Правила:
 * - `my_chat_member` в группе: бот появился в чате (не был → стал участником) —
 *   `save_chat`, если добавил пользователь из allowlist админов, иначе `ignore`;
 *   бот удалён (стал left/kicked) — `clear_chat` независимо от того, кто удалил.
 * - `message.migrate_to_chat_id` — `migrate_chat` (смена id при апгрейде группы).
 * - Любое личное сообщение — `greet`.
 * - Всё остальное (групповые сообщения, каналы, мусор) — `ignore`.
 */
export function classifyUpdate(update: unknown, adminIds: Set<number>): WebhookAction {
  if (typeof update !== "object" || update === null) return { type: "ignore" };
  const u = update as TelegramUpdate;

  const member = u.my_chat_member;
  if (member?.chat && typeof member.chat.id === "number" && GROUP_TYPES.has(member.chat.type ?? "")) {
    const oldStatus = member.old_chat_member?.status ?? "";
    const newStatus = member.new_chat_member?.status ?? "";
    const joined = !IN_CHAT_STATUSES.has(oldStatus) && IN_CHAT_STATUSES.has(newStatus);
    const removed = IN_CHAT_STATUSES.has(oldStatus) && OUT_OF_CHAT_STATUSES.has(newStatus);

    if (joined && typeof member.from?.id === "number" && adminIds.has(member.from.id)) {
      return { type: "save_chat", chatId: member.chat.id };
    }
    if (removed) {
      return { type: "clear_chat", chatId: member.chat.id };
    }
    return { type: "ignore" };
  }

  const message = u.message;
  if (message?.chat && typeof message.chat.id === "number") {
    if (typeof message.migrate_to_chat_id === "number") {
      return {
        type: "migrate_chat",
        fromChatId: message.chat.id,
        toChatId: message.migrate_to_chat_id
      };
    }
    if (message.chat.type === "private") {
      return { type: "greet", chatId: message.chat.id };
    }
  }

  return { type: "ignore" };
}
