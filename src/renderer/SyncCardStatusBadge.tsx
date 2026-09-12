import type { ReactNode } from "react";

import type { SyncCardStatus } from "../shared/sync-card-status";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export function SyncCardStatusBadge({ status }: { status: SyncCardStatus }): ReactNode {
  const t = useT();
  const label = status === "pending"
    ? t("settings.sync.cardStatusPending")
    : status === "syncing"
      ? t("settings.sync.statusSyncing")
      : t("settings.sync.cardStatusConflict");
  return (
    <span
      aria-label={label}
      className="asset-sync-status"
      data-hover-tip={label}
      data-state={status}
    >
      {status !== "conflict" ? (
        <span aria-hidden="true" className="asset-sync-status-ring" />
      ) : (
        <Icon name="warning" size={11} />
      )}
    </span>
  );
}
