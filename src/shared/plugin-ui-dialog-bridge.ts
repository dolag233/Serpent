import { z } from 'zod';

/**
 * Plugin modal dialog bridge (Serpent-a3de58).
 *
 * Main resolves a `serpent.ui.openDialog` call by asking the focused window to
 * host the plugin dialog iframe. The Renderer answers over the result channel;
 * Main resolves the pending Gateway command with the submitted JSON (null on
 * cancellation).
 */

export const PLUGIN_UI_DIALOG_REQUEST_CHANNEL = 'plugin-ui-dialog:request';
export const PLUGIN_UI_DIALOG_RESULT_CHANNEL = 'plugin-ui-dialog:result';

export const pluginUiDialogRequestPayloadSchema = z.strictObject({
  requestId: z.string().min(1).max(255),
  pluginId: z.string().min(1).max(255),
  pluginInstanceId: z.string().min(1).max(255),
  dialogId: z.string().min(1).max(255),
  libraryId: z.string().min(1).max(255),
  payload: z.unknown().nullable(),
});
export type PluginUiDialogRequestPayload = z.infer<typeof pluginUiDialogRequestPayloadSchema>;

export const pluginUiDialogResultPayloadSchema = z.strictObject({
  requestId: z.string().min(1).max(255),
  result: z.unknown().nullable(),
});
export type PluginUiDialogResultPayload = z.infer<typeof pluginUiDialogResultPayloadSchema>;
