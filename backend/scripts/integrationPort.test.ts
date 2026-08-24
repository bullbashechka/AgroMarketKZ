import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { findFreePort } from "./integrationPort";

describe("findFreePort", () => {
  let occupied: Server | undefined;

  afterAll(async () => {
    if (!occupied) return;
    await new Promise<void>((resolve, reject) => occupied!.close((error) => error ? reject(error) : resolve()));
  });

  test("does not return an already occupied loopback port", async () => {
    occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied!.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
      occupied!.once("error", reject);
    });
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");

    expect(await findFreePort()).not.toBe(address.port);
  });
});
