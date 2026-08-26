import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { HonoEnv } from "../env";

export const SESSION_COOKIE_NAME = "__Host-agromarket_session";
const DEVELOPMENT_SESSION_COOKIE_NAME = "agromarket_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_ROTATION_SECONDS = 12 * 60 * 60;
export const SESSION_GRACE_SECONDS = 60;
/** Activity retention does not need a write on every authenticated read. */
export const SESSION_ACTIVITY_THROTTLE_SECONDS = 60 * 60;

function cookieName(c: Context<HonoEnv>): string {
  return c.get("env").APP_ENV === "production" ? SESSION_COOKIE_NAME : DEVELOPMENT_SESSION_COOKIE_NAME;
}

function secureCookie(c: Context<HonoEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context<HonoEnv>, token: string): void {
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Strict",
    secure: secureCookie(c),
  });
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, cookieName(c), {
    path: "/",
    secure: secureCookie(c),
  });
}

export function sessionTokenFromRequest(c: Context<HonoEnv>): string | undefined {
  return getCookie(c, cookieName(c));
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Derives the replacement token from the old bearer token and the server-only
 * bot secret. A deterministic value lets a retry recover a committed rotation
 * during the old token's grace window without persisting plaintext credentials.
 */
export async function deriveSessionRotationToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`agromarketkz:session-rotation:v1:${token}`),
  );
  return Buffer.from(digest).toString("base64url");
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}
