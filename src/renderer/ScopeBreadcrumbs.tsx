import type { ManagedFolderBreadcrumbEntry } from "./folder-breadcrumb-trail";

export type ScopeBreadcrumbSegment =
  | { kind: "static"; id: string; label: string }
  | { kind: "folder"; id: string; label: string; folderId: string };

export type ScopeBreadcrumbsProps = {
  segments: ScopeBreadcrumbSegment[];
  onNavigateFolder: (folderId: string) => void;
};

export function buildScopeBreadcrumbSegments(input: {
  showTrash: boolean;
  activeTagLabel: string | null;
  activeCollectionLabel: string | null;
  activeSmartCollectionLabel: string | null;
  assetScope: string;
  folderTrail: ManagedFolderBreadcrumbEntry[];
  linkedFolderLabel?: string | null;
}): ScopeBreadcrumbSegment[] {
  if (input.showTrash) {
    return [{ kind: "static", id: "trash", label: "回收站" }];
  }
  if (input.activeTagLabel) {
    return [
      { kind: "static", id: "tag", label: `标签 · ${input.activeTagLabel}` },
    ];
  }
  if (input.activeCollectionLabel) {
    return [
      {
        kind: "static",
        id: "collection",
        label: `合集 · ${input.activeCollectionLabel}`,
      },
    ];
  }
  if (input.activeSmartCollectionLabel) {
    return [
      {
        kind: "static",
        id: "smart",
        label: `智能合集 · ${input.activeSmartCollectionLabel}`,
      },
    ];
  }
  if (input.assetScope === "all") {
    return [{ kind: "static", id: "all", label: "所有资产" }];
  }
  if (input.assetScope === "root") {
    return [{ kind: "static", id: "root", label: "资源库根目录" }];
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
  return [{ kind: "static", id: "workspace", label: "工作区" }];
}

/**
 * Borderless scope trail. Does not include a leading "资源库 >" prefix.
 * Workspace back/forward controls live in `ScopeHistoryButtons`, rendered
 * leftmost in the app toolbar.
 */
export function ScopeBreadcrumbs({
  segments,
  onNavigateFolder,
}: ScopeBreadcrumbsProps) {
  return (
    <div className="scope-trace">
      <nav aria-label="当前浏览范围" className="scope-breadcrumbs">
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
