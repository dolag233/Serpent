/// <reference types="vite/client" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module "*free-port.mjs" {
  export function findFreeTcpPort(
    start?: number,
    maxAttempts?: number,
    host?: string,
  ): Promise<number>;
}
