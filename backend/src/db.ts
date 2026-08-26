import postgres, { type Sql } from "postgres";
import { HttpError } from "./lib/errors";
import type { AppEnv } from "./env";

const { PostgresError } = postgres;

export const POSTGRES_POOL_OPTIONS = Object.freeze({
  // Hyperdrive owns the shared connection pool. A single logical client per
  // invocation keeps local Bun behavior aligned without adding another pool
  // in the application layer.
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
}) satisfies postgres.Options<{}>;

const CONNECTION_ERROR_CODES = new Set([
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

const CLOUDFLARE_POSTGRES_WRITE_FRAMES = [
  "at EventEmitter.write",
  "at nextWrite",
  "at cachedError",
  "at new Query",
] as const;

type DatabaseEnv = Pick<AppEnv, "DATABASE_URL" | "HYPERDRIVE">;

/** The only query shape exposed to the explicit idempotent retry capability. */
export type StandaloneSql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T>;

/** A DB capability owned by one request, queue batch, or scheduled invocation. */
export interface Database {
  readonly sql: Sql;
}

/**
 * Database capability for jobs whose individual standalone statement is
 * demonstrably safe to repeat after an ambiguous connection failure.
 */
export interface IdempotentDatabase extends Database {
  retryIdempotentStandalone: <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T>;
}

/** Invocation-owned capability. Worker code leaves disposal to the platform. */
export interface DatabaseInvocation extends IdempotentDatabase {
  dispose: () => Promise<void>;
}

export interface DatabaseInvocationDependencies {
  createClient?: (env: DatabaseEnv) => Sql;
}

function createClient(env: DatabaseEnv): Sql {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new Error("Не задан Hyperdrive или DATABASE_URL");
  return postgres(url, POSTGRES_POOL_OPTIONS);
}

/**
 * Errors from postgres.js and the application are not transport errors. A
 * code-less Cloudflare socket failure is accepted only when all known frames
 * occur in their expected order.
 */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof PostgresError || err instanceof HttpError) return false;
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;

  const stack = (err as { stack?: unknown }).stack;
  if (typeof stack !== "string") return false;
  let previousIndex = -1;
  for (const frame of CLOUDFLARE_POSTGRES_WRITE_FRAMES) {
    const index = stack.indexOf(frame, previousIndex + 1);
    if (index === -1) return false;
    previousIndex = index;
  }
  return true;
}

function isTaggedTemplate(args: unknown[]): boolean {
  return Array.isArray((args[0] as { raw?: unknown } | undefined)?.raw);
}

/**
 * Creates all mutable DB state inside one invocation closure. The proxy keeps
 * the existing recovery behavior for the next call, while deliberately
 * rethrowing the failed query so a transport layer never guesses whether a
 * write reached PostgreSQL.
 */
export function createDatabaseInvocation(
  env: DatabaseEnv,
  dependencies: DatabaseInvocationDependencies = {},
): DatabaseInvocation {
  let current: Sql | undefined;
  let reconnecting: Promise<void> | undefined;
  let disposed = false;
  const clients = new Set<Sql>();

  const create = (): Sql => {
    if (disposed) throw new Error("DB invocation уже завершён");
    const next = dependencies.createClient?.(env) ?? createClient(env);
    clients.add(next);
    current = next;
    return next;
  };

  const getCurrent = (): Sql => current ?? create();

  const reconnect = (failedClient: Sql): Promise<void> => {
    if (current !== failedClient) return Promise.resolve();
    if (!reconnecting) {
      reconnecting = Promise.resolve()
        .then(() => {
          if (current === failedClient) {
            // Keep the stale client in the invocation-owned set. It is closed
            // by local disposal after all foreground/background I/O settles;
            // Workers do not call dispose because Hyperdrive owns cleanup.
            current = create();
          }
        })
        .finally(() => {
          reconnecting = undefined;
        });
    }
    return reconnecting;
  };

  const target = (() => undefined) as unknown as Sql;
  const sql = new Proxy(target, {
    apply(_target, thisArg, args) {
      const client = getCurrent();
      const result = Reflect.apply(client, thisArg, args);
      if (!isTaggedTemplate(args)) return result;
      return (async () => {
        try {
          return await result;
        } catch (err) {
          if (!isConnectionError(err)) throw err;
          await reconnect(client);
          throw err;
        }
      })();
    },
    get(_target, prop, receiver) {
      const client = getCurrent();
      const value = Reflect.get(client, prop, receiver);
      if (prop !== "begin" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, client, args);
        } catch (err) {
          if (isConnectionError(err)) await reconnect(client);
          // A transaction callback is never invoked a second time. An error
          // at COMMIT is ambiguous and must be resolved by the domain receipt.
          throw err;
        }
      };
    },
  });

  const retryIdempotentStandalone = async <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> => {
    const execute = (client: Sql): Promise<T> =>
      Reflect.apply(client, client, [strings, ...values]) as Promise<T>;
    const client = getCurrent();
    try {
      return await execute(client);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      await reconnect(client);
      // This is the one and only explicit retry. A second failure propagates.
      return await execute(getCurrent());
    }
  };

  return {
    sql,
    retryIdempotentStandalone,
    async dispose() {
      if (disposed) return;
      disposed = true;
      current = undefined;
      reconnecting = undefined;
      const ownedClients = [...clients];
      clients.clear();
      await Promise.all(ownedClients.map((client) => client.end({ timeout: 0 })));
    },
  };
}
