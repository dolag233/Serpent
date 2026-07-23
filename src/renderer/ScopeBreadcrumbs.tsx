import type { ManagedFolderBreadcrumbEntry } from "./folder-breadcrumb-trail";
import { useT, type TranslateFn } from "./i18n";
import type { TrashBreadcrumbHop } from "./trash-browse";

export type ScopeBreadcrumbSegment =
  | { kind: "static"; id: string; label: string }
  | { kind: "folder"; id: string; label: string; folderId: string }
  /** Trash hierarchy hop; path null = trash root (Serpent-6pcd). */
  | { kind: "trash-path"; id: string; label: string; path: string | null };

export type ScopeBreadcrumbsProps = {
  segments: ScopeBreadcrumbSegment[];
  onNavigateFolder: (folderId: string) => void;
  onNavigateTrashPath?: (path: string | null) => void;
};

export function buildScopeBreadcrumbSegments(
  input: {
    showTrash: boolean;
    trashBreadcrumbHops?: readonly TrashBreadcrumbHop[];
    activeTagLabel: string | null;
    activeCollectionLabel: string | null;
    activeSmartCollectionLabel: string | null;
    assetScope: string;
    folderTrail: ManagedFolderBreadcrumbEntry[];
    linkedFolderLabel?: string | null;
  },
  t: TranslateFn,
): ScopeBreadcrumbSegment[] {
  if (input.showTrash) {
    const hops = input.trashBreadcrumbHops;
    if (hops && hops.length > 0) {
      return hops.map((hop, index) => ({
        kind: "trash-path" as const,
        id: hop.path === null ? "trash" : `trash:${hop.path}`,
        label: hop.label,
        path: hop.path,
      }));
    }
    return [{ kind: "static", id: "trash", label: t("scope.trash") }];
  }
  if (input.activeTagLabel) {
    return [
      {
        kind: "static",
        id: "tag",
        label: t("scope.tagScope", { name: input.activeTagLabel }),
      },
    ];
  }
  if (input.activeCollectionLabel) {
    return [
      {
        kind: "static",
        id: "collection",
        label: t("scope.collectionScope", {
          name: input.activeCollectionLabel,
        }),
      },
    ];
  }
  if (input.activeSmartCollectionLabel) {
    return [
      {
        kind: "static",
        id: "smart",
        label: t("scope.smartCollectionScope", {
          name: input.activeSmartCollectionLabel,
        }),
      },
    ];
  }
  if (input.assetScope === "all") {
    return [{ kind: "static", id: "all", label: t("scope.allAssets") }];
  }
  if (input.assetScope === "root") {
    return [{ kind: "static", id: "root", label: t("scope.rootFolder") }];
  }
  if (input.folderTrail.length > 0) {
    return input.folderTrail.map((entry) => ({
      kind: "folder" as const,
      id: entry.folderId,
      label: entry.name,
      folderId: entry.folderId,
    }));
  }
  if (input.linkedFolderLabel) {
    return [
      {
        kind: "static",
        id: input.assetScope,
        label: input.linkedFolderLabel,
      },
    ];
  }
  return [{ kind: "static", id: "workspace", label: t("scope.workspace") }];
}

/**
 * Borderless scope trail. Does not include a leading library prefix.
 * Workspace back/forward controls live in `ScopeHistoryButtons`, rendered
 * at the leading edge of the browse toolbar column.
 */
export function ScopeBreadcrumbs({
  segments,
  onNavigateFolder,
  onNavigateTrashPath,
}: ScopeBreadcrumbsProps) {
  const t = useT();
  return (
    <div className="scope-trace">
      <nav aria-label={t("scope.currentBrowseScope")} className="scope-breadcrumbs">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <span className="scope-crumb" key={segment.id}>
              {index > 0 && <span className="scope-sep">&gt;</span>}
              {segment.kind === "folder" && !isLast ? (
                <button
                  className="scope-crumb-button"
                  onClick={() => onNavigateFolder(segment.folderId)}
                  type="button"
                >
                  {segment.label}
                </button>
              ) : segment.kind === "trash-path" && !isLast ? (
                <button
                  className="scope-crumb-button"
                  onClick={() => onNavigateTrashPath?.(segment.path)}
                  type="button"
                >
                  {segment.label}
                </button>
              ) : (
                <span
                  className={`scope-crumb-label${isLast ? " is-current" : ""}`}
                >
                  {segment.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
