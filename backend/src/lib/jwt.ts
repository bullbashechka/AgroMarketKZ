import { sign, verify } from "hono/jwt";
import { z } from "zod";
import type { AppEnv } from "../env";

/** Срок жизни JWT — 24 часа; Mini App перевыпускает его из свежего initData. */
export const TOKEN_TTL_SEC = 24 * 60 * 60;

export interface TokenClaims {
  /** id пользователя в нашей БД. */
  sub: string;
  /** Telegram id (для живой проверки прав админа). */
  tgId: number;
  /** Версия сессии: increment в БД отзывает все ранее выданные токены пользователя. */
  ver: number;
  /** Время выпуска токена в Unix-секундах. */
  iat: number;
  exp: number;
}

const tokenClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    tgId: z.number().int().safe().positive(),
    exp: z.number().int().positive(),
    ver: z.number().int().nonnegative().optional(),
    iat: z.number().int().nonnegative().optional(),
  })
  .refine(
    (claims) =>
      (claims.ver === undefined) === (claims.iat === undefined) &&
      (claims.iat === undefined || claims.exp > claims.iat),
  );

/** Выпускает подписанный JWT для пользователя. */
export function issueToken(env: AppEnv, userId: string, telegramId: number, tokenVersion: number): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SEC;
  return sign({ sub: userId, tgId: telegramId, ver: tokenVersion, iat, exp } satisfies TokenClaims, env.JWT_SECRET, "HS256");
}

/** Проверяет JWT; бросает, если подпись неверна или срок истёк. */
export async function verifyToken(
  env: AppEnv,
  token: string
): Promise<{ userId: string; telegramId: number; tokenVersion: number; issuedAt: number | undefined }> {
  const payload = tokenClaimsSchema.parse(await verify(token, env.JWT_SECRET, "HS256"));
  return {
    userId: payload.sub,
    telegramId: payload.tgId,
    tokenVersion: payload.ver ?? 0,
    issuedAt: payload.iat,
  };
}
