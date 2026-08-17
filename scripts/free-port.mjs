import net from "node:net";

/**
 * Find a free TCP port on the loopback, scanning upward from `start`.
 * Used by `npm start` so Vite never silently bumps past a stale URL
 * (Electron Forge black-screen: MAIN_WINDOW_VITE_DEV_SERVER_URL stuck on 5173).
 *
 * Both IPv4 (127.0.0.1) and IPv6 (::1) must be bindable: Vite's default
 * `localhost` listen may land on either stack, so a port that is only free
 * on one stack would still collide (observed: another dev instance bound
 * ::1:5173 while the IPv4-only probe reported 5173 free).
 */
export function findFreeTcpPort(
  start = 5173,
  maxAttempts = 80,
) {
  return new Promise((resolve, reject) => {
    let port = Math.max(1, Math.floor(start));
    const last = port + Math.max(1, maxAttempts) - 1;

    const canBind = (candidate, host) =>
      new Promise((ok, fail) => {
        const server = net.createServer();
        server.unref();
        server.once("error", (error) => fail(error));
        server.listen({ port: candidate, host, exclusive: true }, () => {
          server.close((closeError) => {
            if (closeError) {
              fail(closeError);
              return;
            }
            ok();
          });
        });
      });

    const tryEphemeral = () => {
      const server = net.createServer();
      server.unref();
      server.once("error", (error) => reject(error));
      server.listen({ port: 0, host: "127.0.0.1", exclusive: true }, () => {
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
        reject(
          new Error(
            `No free TCP port on loopback in range ${start}–${last}.`,
          ),
        );
        return;
      }
      const candidate = port;
      port += 1;
      canBind(candidate, "127.0.0.1")
        .then(() => canBind(candidate, "::1"))
        .then(() => resolve(candidate))
        .catch((error) => {
          if (error?.code === "EACCES") {
            tryEphemeral();
            return;
          }
          tryListen();
        });
    };

    tryListen();
  });
}
