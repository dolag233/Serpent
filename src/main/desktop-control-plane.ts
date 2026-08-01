import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {
  DESKTOP_CONTROL_MAX_FRAME_BYTES,
  desktopControlHelloSchema,
  desktopControlMcpRequestSchema,
  desktopControlRequestSchema,
  type DesktopControlHelloResponse,
  type DesktopControlMcpResponse,
  type DesktopControlResponse,
} from '../shared/desktop-control';

export type DesktopControlPlaneLogger = {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
};

export type DesktopControlSession = {
  sessionId: string;
  clientName: string;
  libraryId: string;
  writeAccessGranted: boolean;
};

export type DesktopControlPlaneOptions = {
  userDataPath: string;
  logger: DesktopControlPlaneLogger;
  onHello: (
    request: {
      clientName: string;
      requestWriteAccess: boolean;
    },
    sessionId: string,
  ) => Promise<Omit<DesktopControlHelloResponse, 'type'>>;
  onMcpRequest: (
    session: DesktopControlSession,
    request: { method: 'tools/list' | 'tools/call'; params: Record<string, unknown> },
  ) => Promise<unknown>;
  onSessionClosed?: (session: DesktopControlSession) => void;
};

export type DesktopControlEndpointInfo = {
  endpoint: string | { host: '127.0.0.1'; port: number };
  metadataPath: string;
  nonce: string;
};

export function desktopControlEndpointInfo(userDataPath: string): DesktopControlEndpointInfo {
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\serpent-desktop-${createHash('sha256').update(userDataPath).digest('hex').slice(0, 24)}`
      : path.join(userDataPath, 'desktop-control.sock');
  return {
    endpoint,
    metadataPath: path.join(userDataPath, 'desktop-control.json'),
    nonce: '',
  };
}

export function readDesktopControlEndpoint(
  userDataPath: string,
): DesktopControlEndpointInfo | null {
  const metadataPath = path.join(userDataPath, 'desktop-control.json');
  if (!existsSync(metadataPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      endpoint?: unknown;
      nonce?: unknown;
    };
    const endpoint =
      typeof parsed.endpoint === 'string'
        ? parsed.endpoint
        : typeof parsed.endpoint === 'object'
          && parsed.endpoint !== null
          && (parsed.endpoint as { host?: unknown }).host === '127.0.0.1'
          && Number.isInteger((parsed.endpoint as { port?: unknown }).port)
          && ((parsed.endpoint as { port: number }).port > 0)
          ? {
              host: '127.0.0.1' as const,
              port: (parsed.endpoint as { port: number }).port,
            }
          : null;
    if (endpoint === null || typeof parsed.nonce !== 'string') return null;
    return {
      endpoint,
      metadataPath,
      nonce: parsed.nonce,
    };
  } catch {
    return null;
  }
}

function removeIfPresent(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function publicErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Desktop control request failed.';
}

export class DesktopControlPlane {
  readonly #options: DesktopControlPlaneOptions;
  readonly #server = net.createServer((socket) => this.#handleConnection(socket));
  readonly #sessions = new Map<net.Socket, DesktopControlSession>();
  #endpointInfo: DesktopControlEndpointInfo | undefined;

  constructor(options: DesktopControlPlaneOptions) {
    this.#options = options;
  }

  get endpointInfo(): DesktopControlEndpointInfo | undefined {
    return this.#endpointInfo;
  }

  async start(): Promise<DesktopControlEndpointInfo> {
    const userDataPath = this.#options.userDataPath;
    mkdirSync(userDataPath, { recursive: true });
    const endpoint = desktopControlEndpointInfo(userDataPath);
    const nonce = randomBytes(32).toString('hex');

    if (process.platform !== 'win32' && typeof endpoint.endpoint === 'string') {
      removeIfPresent(endpoint.endpoint);
    }
    removeIfPresent(endpoint.metadataPath);

    const listen = (address: string | { host: '127.0.0.1'; port: number }): Promise<void> =>
      new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.removeListener('error', onError);
        resolve();
      };
      this.#server.once('error', onError);
      this.#server.once('listening', onListening);
      this.#server.listen(address);
    });

    try {
      await listen(endpoint.endpoint);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        !['EPERM', 'EINVAL', 'ENAMETOOLONG'].includes(code ?? '')
        || process.platform === 'win32'
      ) {
        throw error;
      }
      await listen({ host: '127.0.0.1', port: 0 });
      const address = this.#server.address();
      if (address === null || typeof address === 'string') throw error;
      endpoint.endpoint = { host: '127.0.0.1', port: address.port };
      this.#options.logger.info(
        'desktop.control-plane',
        'Unix socket unavailable; using loopback endpoint.',
      );
    }

    if (process.platform !== 'win32' && typeof endpoint.endpoint === 'string') {
      chmodSync(endpoint.endpoint, 0o600);
    }
    const metadata = { endpoint: endpoint.endpoint, nonce };
    writeFileSync(endpoint.metadataPath, JSON.stringify(metadata), {
      encoding: 'utf8',
      mode: 0o600,
    });
    if (process.platform !== 'win32') chmodSync(endpoint.metadataPath, 0o600);

    this.#endpointInfo = { ...endpoint, nonce };
    this.#options.logger.info('desktop.control-plane', 'Desktop control plane started.');
    return this.#endpointInfo;
  }

  async close(): Promise<void> {
    for (const socket of this.#sessions.keys()) socket.destroy();
    await new Promise<void>((resolve) => {
      if (!this.#server.listening) {
        resolve();
        return;
      }
      this.#server.close(() => resolve());
    });
    const endpoint = this.#endpointInfo;
    if (endpoint !== undefined) {
      if (process.platform !== 'win32' && typeof endpoint.endpoint === 'string') {
        removeIfPresent(endpoint.endpoint);
      }
      removeIfPresent(endpoint.metadataPath);
    }
    this.#endpointInfo = undefined;
  }

  #handleConnection(socket: net.Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';
    let session: DesktopControlSession | undefined;

    const send = (response: DesktopControlResponse): void => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > DESKTOP_CONTROL_MAX_FRAME_BYTES) {
        send({ type: 'error', code: 'DESKTOP_CONTROL_FRAME_TOO_LARGE', message: 'Desktop control frame is too large.' });
        socket.destroy();
        return;
      }

      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() === '') continue;
        void this.#handleMessage(socket, line, send, () => {
          session = this.#sessions.get(socket);
        });
      }
    });
    socket.on('close', () => {
      this.#sessions.delete(socket);
      if (session !== undefined) this.#options.onSessionClosed?.(session);
    });
    socket.on('error', (error) => {
      this.#options.logger.error('desktop.control-plane.connection', error);
    });
  }

  async #handleMessage(
    socket: net.Socket,
    line: string,
    send: (response: DesktopControlResponse) => void,
    markHandshake: () => void,
  ): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      send({ type: 'error', code: 'DESKTOP_CONTROL_MALFORMED_FRAME', message: 'Malformed Desktop control frame.' });
      return;
    }

    const parsed = desktopControlRequestSchema.safeParse(raw);
    if (!parsed.success) {
      send({ type: 'error', code: 'DESKTOP_CONTROL_INVALID_REQUEST', message: 'Invalid Desktop control request.' });
      return;
    }

    const currentSession = this.#sessions.get(socket);
    if (parsed.data.type === 'hello') {
      if (currentSession !== undefined) {
        send({ type: 'error', code: 'DESKTOP_CONTROL_ALREADY_ATTACHED', message: 'Desktop control session is already attached.' });
        return;
      }
      const endpoint = this.#endpointInfo;
      const hello = desktopControlHelloSchema.parse(parsed.data);
      if (endpoint === undefined || hello.nonce !== endpoint.nonce) {
        send({ type: 'error', code: 'DESKTOP_CONTROL_ATTACH_DENIED', message: 'Desktop control attachment was denied.' });
        socket.destroy();
        return;
      }
      try {
        const sessionId = randomUUID();
        const response = await this.#options.onHello({
          clientName: hello.clientName,
          requestWriteAccess: hello.requestWriteAccess,
        }, sessionId);
        const nextSession: DesktopControlSession = {
          sessionId,
          clientName: hello.clientName,
          libraryId: response.libraryId,
          writeAccessGranted: response.writeAccessGranted,
        };
        this.#sessions.set(socket, nextSession);
        markHandshake();
        send({ type: 'hello.result', ...response });
      } catch (error) {
        this.#options.logger.error('desktop.control-plane.attach', error);
        send({ type: 'error', code: 'DESKTOP_CONTROL_ATTACH_FAILED', message: publicErrorMessage(error) });
        socket.destroy();
      }
      return;
    }

    if (currentSession === undefined) {
      send({ type: 'error', code: 'DESKTOP_CONTROL_HANDSHAKE_REQUIRED', message: 'Desktop control handshake is required.' });
      socket.destroy();
      return;
    }

    if (parsed.data.type === 'close') {
      socket.end();
      return;
    }

    const request = desktopControlMcpRequestSchema.parse(parsed.data);
    try {
      const result = await this.#options.onMcpRequest(currentSession, {
        method: request.method,
        params: request.params,
      });
      const response: DesktopControlMcpResponse = {
        type: 'mcp.response',
        requestId: request.requestId,
        ok: true,
        result,
      };
      send(response);
    } catch (error) {
      this.#options.logger.error('desktop.control-plane.request', error, {
        sessionId: currentSession.sessionId,
      });
      send({
        type: 'mcp.response',
        requestId: request.requestId,
        ok: false,
        error: {
          code: 'DESKTOP_CONTROL_REQUEST_FAILED',
          message: publicErrorMessage(error),
        },
      });
    }
  }
}
