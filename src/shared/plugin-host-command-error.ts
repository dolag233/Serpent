const DEFAULT_PLUGIN_HOST_COMMAND_ERROR = {
  code: 'HOST_COMMAND_FAILED',
  message: 'The automation command could not complete.',
} as const;

/** Only explicitly marked Main errors may cross a plugin runtime boundary. */
export class PluginHostCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginHostCommandError';
    this.code = code;
  }
}

export function toPluginHostCommandFailure(error: unknown): { code: string; message: string } {
  if (error instanceof PluginHostCommandError) {
    return {
      code: error.code.slice(0, 128),
      message: error.message.slice(0, 1_024) || DEFAULT_PLUGIN_HOST_COMMAND_ERROR.message,
    };
  }
  return DEFAULT_PLUGIN_HOST_COMMAND_ERROR;
}
