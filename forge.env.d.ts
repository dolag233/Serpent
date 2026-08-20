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

declare module "*ticket.mjs" {
  export function issuesPath(root: string): string;
  export function readIssues(filePath: string): Array<Record<string, unknown>>;
  export class TicketError extends Error {
    readonly exitCode: number;
  }
  export function writeIssues(
    filePath: string,
    issues: readonly Record<string, unknown>[],
  ): void;
}
