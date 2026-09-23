/**
 * Serpent-d7acfa：画布文件夹卡片多选后的批量动作规划。
 *
 * 选中集合里既有托管文件夹、也有链接文件夹（根/子目录）与失效 id，每种动作的
 * 资格不同。这里把「谁能做、谁被跳过、为什么」一次算清，命令层与菜单层共用同一
 * 结论，避免每个动作各写一遍判断；跳过原因沿用 `menu-skip-report` 的既有码，
 * 不新造一套脚注。
 */

import type { MenuSkipReasonCode } from "./menu-skip-report";

export type FolderBatchAction =
  | "trash"
  | "delete-from-disk"
  | "appearance"
  | "ignore";

export interface FolderBatchManagedFolder {
  readonly folderId: string;
  readonly name: string;
  readonly relativePath: string;
}

export interface FolderBatchLinkedFolder {
  readonly folderId: string;
  readonly name: string;
  /** 链接根为空字符串；子目录为其相对路径。 */
  readonly relativePath?: string;
}

export interface FolderBatchTarget {
  readonly folderId: string;
  readonly kind: "managed-folder" | "linked-folder";
  readonly name: string;
  readonly relativePath: string;
  /** 链接根为 ''，链接子目录为子路径，托管文件夹为 null。 */
  readonly linkedRelativePath: string | null;
}

export interface FolderBatchSkip {
  readonly reason: MenuSkipReasonCode;
  readonly count: number;
}

export interface FolderBatchPlan {
  /** 本次动作真正会作用到的文件夹。 */
  readonly targets: readonly FolderBatchTarget[];
  readonly skips: readonly FolderBatchSkip[];
  readonly skipCount: number;
}

const SKIP_ORDER: readonly MenuSkipReasonCode[] = [
  "linked",
  "unavailable",
  "trashed",
  "unresolved",
  "folder",
];

function skipList(buckets: Map<MenuSkipReasonCode, number>): FolderBatchSkip[] {
  return SKIP_ORDER.filter((reason) => (buckets.get(reason) ?? 0) > 0).map(
    (reason) => ({ reason, count: buckets.get(reason)! }),
  );
}

/**
 * 资格规则（与单文件夹菜单保持一致）：
 * - 托管文件夹：四种动作都支持；
 * - 链接文件夹根：除「移入回收站」外都支持（2026-09-15 用户决定：链接条目没有
 *   回收站语义，只有强制删除 / 外观 / 忽略）；
 * - 链接文件夹子目录：忽略写入同一份 `.serpentignore`；磁盘删除走子树；外观/
 *   回收站仍跳过（`linked`）；
 * - 找不到的 id（资源库根、已删除、跨库残留）：跳过（`unresolved`）。
 */
export function planFolderBatch(input: {
  readonly folderIds: readonly string[];
  readonly managedFolders: readonly FolderBatchManagedFolder[];
  readonly linkedFolders: readonly FolderBatchLinkedFolder[];
  readonly action: FolderBatchAction;
}): FolderBatchPlan {
  const managedById = new Map(
    input.managedFolders.map((folder) => [folder.folderId, folder]),
  );
  const linkedById = new Map(
    input.linkedFolders.map((folder) => [folder.folderId, folder]),
  );
  const targets: FolderBatchTarget[] = [];
  const skips = new Map<MenuSkipReasonCode, number>();

  for (const folderId of input.folderIds) {
    const managed = managedById.get(folderId);
    if (managed) {
      targets.push({
        folderId,
        kind: "managed-folder",
        name: managed.name,
        relativePath: managed.relativePath,
        linkedRelativePath: null,
      });
      continue;
    }
    const linked = linkedById.get(folderId);
    if (linked) {
      const relativePath = linked.relativePath ?? "";
      if (relativePath !== "") {
        if (input.action === "ignore") {
          targets.push({
            folderId,
            kind: "linked-folder",
            name: linked.name,
            relativePath,
            linkedRelativePath: relativePath,
          });
          continue;
        }
        // 链接子目录：外观没有独立存储；磁盘删除走子树；回收站不适用。
        skips.set("linked", (skips.get("linked") ?? 0) + 1);
        continue;
      }
      if (input.action === "trash") {
        skips.set("linked", (skips.get("linked") ?? 0) + 1);
        continue;
      }
      targets.push({
        folderId,
        kind: "linked-folder",
        name: linked.name,
        relativePath: "",
        linkedRelativePath: null,
      });
      continue;
    }
    skips.set("unresolved", (skips.get("unresolved") ?? 0) + 1);
  }

  const skipsOut = skipList(skips);
  return {
    targets,
    skips: skipsOut,
    skipCount: skipsOut.reduce((sum, item) => sum + item.count, 0),
  };
}

/** 「设置图标」的菜单计数：可设置的文件夹数量。 */
export function folderBatchProcessCount(plan: FolderBatchPlan): number {
  return plan.targets.length;
}
