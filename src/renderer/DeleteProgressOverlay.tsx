import type { ReactNode } from "react";

import type { DeleteProgressEvent } from "../shared/protocol/responses";
import { BlockingProgressOverlay } from "./BlockingProgressOverlay";
import {
  deleteOverlayDetail,
  deleteOverlayTitleKey,
  isDeleteProgressCancelable,
} from "./delete-progress-copy";
import { useT } from "./i18n";

export type DeleteProgressOverlayProps = {
  readonly progress: DeleteProgressEvent | null;
  readonly onCancel?: () => void;
};

export function DeleteProgressOverlay({
  progress,
  onCancel,
}: DeleteProgressOverlayProps): ReactNode {
  const t = useT();
  const title = t(deleteOverlayTitleKey(progress?.kind));
  const detail = deleteOverlayDetail(progress);
  const detailText = detail.params ? t(detail.key, detail.params) : t(detail.key);
  const determinate = (progress?.totalFiles ?? 0) > 0;
  const cancelable = isDeleteProgressCancelable(progress);

  return (
    <BlockingProgressOverlay
      cancelLabel={cancelable ? t("progress.cancelDiskDelete") : undefined}
      detail={detailText}
      indeterminate={!determinate}
      kind="delete"
      max={determinate ? progress?.totalFiles : undefined}
      onCancel={cancelable ? onCancel : undefined}
      title={title}
      value={determinate ? progress?.filesProcessed : undefined}
    />
  );
}
