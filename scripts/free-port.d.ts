export function findFreeTcpPort(
  start?: number,
  maxAttempts?: number,
  host?: string,
): Promise<number>;
