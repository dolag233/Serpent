import { z } from 'zod';

import {
  pluginWidgetEventSchema,
  pluginWidgetNodeSchema,
  type PluginWidgetNode,
} from './plugin-widget-ir';

/**
 * Plugin modal dialog bridge (Serpent-a3de58).
 *
 * Main resolves a `serpent.ui.openDialog` call by asking the focused window to
 * host either a widget tree (Host primitives) or a plugin dialog iframe. The
 * Renderer answers over the result channel; Main resolves the pending Gateway
 * command with the submitted JSON (null on cancellation).
 */

export const PLUGIN_UI_DIALOG_REQUEST_CHANNEL = 'plugin-ui-dialog:request';
export const PLUGIN_UI_DIALOG_RESULT_CHANNEL = 'plugin-ui-dialog:result';
export const PLUGIN_UI_DIALOG_PATCH_CHANNEL = 'plugin-ui-dialog:patch';
export const PLUGIN_UI_WIDGET_EVENT_CHANNEL = 'plugin-ui-widget:event';

export const pluginUiDialogRequestPayloadSchema = z.strictObject({
  requestId: z.string().min(1).max(255),
  pluginId: z.string().min(1).max(255),
  pluginInstanceId: z.string().min(1).max(255),
  libraryId: z.string().min(1).max(255),
  dialogId: z.string().min(1).max(255).optional(),
  payload: z.unknown().nullable().optional(),
  sessionId: z.string().uuid().optional(),
  title: z.string().min(1).max(160).optional(),
  submitLabel: z.string().min(1).max(64).optional(),
  tree: pluginWidgetNodeSchema.optional(),
}).superRefine((value, context) => {
  if (value.tree !== undefined) {
    if (value.sessionId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sessionId'],
        message: 'Widget dialogs need a sessionId.',
      });
    }
    if (value.title === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Widget dialogs need a title.',
      });
    }
    return;
  }
  if (value.dialogId === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['dialogId'],
      message: 'Iframe dialogs need a dialogId.',
    });
  }
});
export type PluginUiDialogRequestPayload = z.infer<typeof pluginUiDialogRequestPayloadSchema>;

export function isPluginUiWidgetDialogRequest(
  request: PluginUiDialogRequestPayload,
): request is PluginUiDialogRequestPayload & {
  sessionId: string;
  title: string;
  tree: PluginWidgetNode;
} {
  return request.tree !== undefined
    && typeof request.sessionId === 'string'
    && typeof request.title === 'string';
}

export const pluginUiDialogPatchPayloadSchema = z.strictObject({
  requestId: z.string().min(1).max(255),
  tree: pluginWidgetNodeSchema,
});
export type PluginUiDialogPatchPayload = z.infer<typeof pluginUiDialogPatchPayloadSchema>;

export const pluginUiWidgetEventPayloadSchema = pluginWidgetEventSchema.extend({
  sessionId: z.string().uuid(),
});
export type PluginUiWidgetEventPayload = z.infer<typeof pluginUiWidgetEventPayloadSchema>;

export const pluginUiDialogResultPayloadSchema = z.strictObject({
  requestId: z.string().min(1).max(255),
  result: z.unknown().nullable(),
});
export type PluginUiDialogResultPayload = z.infer<typeof pluginUiDialogResultPayloadSchema>;

/**
 * `serpent.ui.openDialog({ dialogId })` takes the Manifest local id. Host
 * contribution ids are `pluginId.libraryId.localId`, so exact equality against
 * `contribution.id` would never match a well-formed Guest call.
 */
export function pluginDialogContributionMatches(
  contribution: {
    id: string;
    pluginId: string;
    pluginInstanceId: string;
  },
  request: {
    dialogId: string;
    pluginId: string;
    pluginInstanceId: string;
  },
): boolean {
  if (contribution.pluginId !== request.pluginId) return false;
  if (contribution.pluginInstanceId !== request.pluginInstanceId) return false;
  if (contribution.id === request.dialogId) return true;
  return contribution.id.endsWith(`.${request.dialogId}`);
}
