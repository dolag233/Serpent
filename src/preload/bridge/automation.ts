import { ipcRenderer } from 'electron';

import {
  automationRecentScriptOpenInputSchema,
  automationRecentScriptsListResultSchema,
  automationScriptExecuteResultSchema,
  automationScriptFileResultSchema,
  automationScriptHistoryInputSchema,
  automationScriptHistoryResultSchema,
  automationScriptSaveInputSchema,
  automationScriptStartResultSchema,
  automationScriptUndoInputSchema,
  automationScriptUndoResultSchema,
  type AutomationRecentScriptOpenInput,
  type AutomationScriptCancelInput,
  type AutomationScriptCommandInput,
  type AutomationScriptCommandResult,
  type AutomationScriptCompleteInput,
  type AutomationScriptExecuteInput,
  type AutomationScriptHistoryInput,
  type AutomationScriptSaveInput,
  type AutomationScriptStartInput,
  type AutomationScriptUndoInput,
  type SerpentAutomationScriptApi,
} from '../../shared/automation-script-api';
import {
  AUTOMATION_SCRIPT_CANCEL_CHANNEL,
  AUTOMATION_SCRIPT_COMMAND_CHANNEL,
  AUTOMATION_SCRIPT_COMPLETE_CHANNEL,
  AUTOMATION_SCRIPT_EXECUTE_CHANNEL,
  AUTOMATION_SCRIPT_HISTORY_CHANNEL,
  AUTOMATION_SCRIPT_OPEN_CHANNEL,
  AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL,
  AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL,
  AUTOMATION_SCRIPT_SAVE_CHANNEL,
  AUTOMATION_SCRIPT_START_CHANNEL,
  AUTOMATION_SCRIPT_UNDO_CHANNEL,
} from '../../shared/protocol/channels';

export const automation: SerpentAutomationScriptApi = Object.freeze({
  async open() {
    return automationScriptFileResultSchema.parse(
      await ipcRenderer.invoke(AUTOMATION_SCRIPT_OPEN_CHANNEL),
    );
  },
  async save(input: AutomationScriptSaveInput) {
    return automationScriptFileResultSchema.parse(
      await ipcRenderer.invoke(AUTOMATION_SCRIPT_SAVE_CHANNEL, automationScriptSaveInputSchema.parse(input)),
    );
  },
  async recentList() {
    return automationRecentScriptsListResultSchema.parse(
      await ipcRenderer.invoke(AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL),
    );
  },
  async openRecent(input: AutomationRecentScriptOpenInput) {
    return automationScriptFileResultSchema.parse(
      await ipcRenderer.invoke(
        AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL,
        automationRecentScriptOpenInputSchema.parse(input),
      ),
    );
  },
  async start(input: AutomationScriptStartInput) {
    return automationScriptStartResultSchema.parse(
      await ipcRenderer.invoke(AUTOMATION_SCRIPT_START_CHANNEL, input),
    );
  },
  async execute(input: AutomationScriptExecuteInput) {
    return automationScriptExecuteResultSchema.parse(
      await ipcRenderer.invoke(AUTOMATION_SCRIPT_EXECUTE_CHANNEL, input),
    );
  },
  async command(input: AutomationScriptCommandInput): Promise<AutomationScriptCommandResult> {
    const result = await ipcRenderer.invoke(AUTOMATION_SCRIPT_COMMAND_CHANNEL, input);
    if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
      throw new Error('Main returned an invalid automation command result.');
    }
    return result as AutomationScriptCommandResult;
  },
  async complete(input: AutomationScriptCompleteInput): Promise<void> {
    await ipcRenderer.invoke(AUTOMATION_SCRIPT_COMPLETE_CHANNEL, input);
  },
  async cancel(input: AutomationScriptCancelInput): Promise<void> {
    await ipcRenderer.invoke(AUTOMATION_SCRIPT_CANCEL_CHANNEL, input);
  },
  async history(input: AutomationScriptHistoryInput) {
    return automationScriptHistoryResultSchema.parse(
      await ipcRenderer.invoke(
        AUTOMATION_SCRIPT_HISTORY_CHANNEL,
        automationScriptHistoryInputSchema.parse(input),
      ),
    );
  },
  async undo(input: AutomationScriptUndoInput) {
    return automationScriptUndoResultSchema.parse(
      await ipcRenderer.invoke(
        AUTOMATION_SCRIPT_UNDO_CHANNEL,
        automationScriptUndoInputSchema.parse(input),
      ),
    );
  },
});
