import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { findFreeTcpPort } from "../../scripts/free-port.mjs";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function listen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    servers.push(server);
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected AddressInfo"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("findFreeTcpPort (Serpent-i6xg)", () => {
  it("returns the preferred port when free", async () => {
    const preferred = await findFreeTcpPort(45_000, 20);
    expect(preferred).toBeGreaterThanOrEqual(45_000);
    const again = await findFreeTcpPort(preferred, 1);
    expect(again).toBe(preferred);
  });

  it("skips an occupied port", async () => {
    const occupied = await findFreeTcpPort(46_000, 40);
    await listen(occupied);
    const next = await findFreeTcpPort(occupied, 10);
    expect(next).toBeGreaterThan(occupied);
  });
});
