import { sign, verify } from "hono/jwt";
import type { AppEnv } from "../env";

/** Срок жизни JWT — 30 дней (сессия «как будто вечная», см. решения Этапа 3). */
const TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

export interface TokenClaims {
  /** id пользователя в нашей БД. */
  sub: string;
  /** Telegram id (для живой проверки прав админа). */
  tgId: number;
  exp: number;
}

/** Выпускает подписанный JWT для пользователя. */
export function issueToken(env: AppEnv, userId: string, telegramId: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  return sign({ sub: userId, tgId: telegramId, exp } satisfies TokenClaims, env.JWT_SECRET, "HS256");
}

/** Проверяет JWT; бросает, если подпись неверна или срок истёк. */
export async function verifyToken(
  env: AppEnv,
  token: string
): Promise<{ userId: string; telegramId: number }> {
  const payload = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as TokenClaims;
  return { userId: String(payload.sub), telegramId: Number(payload.tgId) };
}
