import net from "node:net";

/**
 * Find a free TCP port on 127.0.0.1, scanning upward from `start`.
 * Used by `npm start` so Vite never silently bumps past a stale URL
 * (Electron Forge black-screen: MAIN_WINDOW_VITE_DEV_SERVER_URL stuck on 5173).
 */
export function findFreeTcpPort(
  start = 5173,
  maxAttempts = 80,
  host = "127.0.0.1",
) {
  return new Promise((resolve, reject) => {
    let port = Math.max(1, Math.floor(start));
    const last = port + Math.max(1, maxAttempts) - 1;
    let lastError;

    const tryEphemeral = () => {
      const server = net.createServer();
      server.unref();
      server.once("error", (error) => reject(error));
      server.listen({ port: 0, host, exclusive: true }, () => {
        const bound = /** @type {import('node:net').AddressInfo} */ (
          server.address()
        );
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(bound.port);
        });
      });
    };

    const tryListen = () => {
      if (port > last) {
        if (lastError?.code === "EACCES") {
          tryEphemeral();
          return;
        }
        reject(
          lastError ??
            new Error(
              `No free TCP port on ${host} in range ${start}–${last}.`,
            ),
        );
        return;
      }
      const server = net.createServer();
      server.unref();
      server.once("error", (error) => {
        lastError = error;
        port += 1;
        tryListen();
      });
      server.listen({ port, host, exclusive: true }, () => {
        const bound = /** @type {import('node:net').AddressInfo} */ (
          server.address()
        );
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(bound.port);
        });
      });
    };

    tryListen();
  });
}
