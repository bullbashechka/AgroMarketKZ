import { createServer } from "node:net";

/** Allocates an ephemeral loopback port and releases the probe before PostgreSQL starts. */
export async function findFreePort(hostname = "127.0.0.1"): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: hostname, port: 0 }, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine the ephemeral integration-test port");
    }
    return address.port;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }
}
