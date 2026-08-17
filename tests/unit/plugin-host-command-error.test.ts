import { describe, expect, it } from 'vitest';

import {
  PluginHostCommandError,
  toPluginHostCommandFailure,
} from '../../src/shared/plugin-host-command-error';

describe('plugin host command error boundary', () => {
  it('keeps unmarked host failures generic', () => {
    expect(toPluginHostCommandFailure(new Error('/private/library.db leaked'))).toEqual({
      code: 'HOST_COMMAND_FAILED',
      message: 'The automation command could not complete.',
    });
  });

  it('preserves the structured Gateway code and message when explicitly marked', () => {
    expect(toPluginHostCommandFailure(new PluginHostCommandError(
      'AUTOMATION_PLAN_STALE',
      'The replacement plan is stale; refresh the selected assets.',
    ))).toEqual({
      code: 'AUTOMATION_PLAN_STALE',
      message: 'The replacement plan is stale; refresh the selected assets.',
    });
  });
});
