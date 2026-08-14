import { ASSET_NATIVE_DRAG_CHANNEL } from "../shared/protocol/channels";

type NativeAssetDragRequest = {
  readonly libraryId: string;
  readonly assetIds: readonly string[];
};

type NativeAssetDragSender = {
  send(channel: string, input: NativeAssetDragRequest): void;
};

/**
 * Start an OS file drag without synchronously waiting for Main. Electron's
 * native drag uses a nested OS event loop; a sync IPC call deadlocks when the
 * dragged file is dropped back into the same BrowserWindow.
 */
export function sendNativeAssetDrag(
  sender: NativeAssetDragSender,
  input: NativeAssetDragRequest,
): void {
  sender.send(ASSET_NATIVE_DRAG_CHANNEL, input);
}
