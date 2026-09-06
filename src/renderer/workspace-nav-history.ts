export type WorkspaceNavLocation =
  | { kind: "all" }
  | { kind: "root" }
  | { kind: "folder"; folderId: string }
  | { kind: "tag"; tagId: string }
  | { kind: "collection"; collectionId: string; recursive: boolean }
  | { kind: "smart-collection"; collectionId: string }
  | { kind: "trash"; tombstoneId: string | null }
  /**
   * 资产查看器：打开资产 = 一个历史状态（Serpent-b7e173）。查看器内
   * next/prev 用 replaceCurrent 原地更新 assetId，不新增历史条目。
   */
  | { kind: "preview"; assetId: string }
  | { kind: "tag-management" };

export type WorkspaceNavHistory = {
  current: WorkspaceNavLocation;
  canBack: boolean;
  canForward: boolean;
  push: (location: WorkspaceNavLocation) => void;
  /** 原地替换当前条目（查看器内切资产用），不清空 forward 分支。 */
  replaceCurrent: (location: WorkspaceNavLocation) => void;
  /** 移除当前条目并回退到前一条（X/Esc 主动关闭查看器用），无 forward 残留。 */
  dismissCurrent: () => void;
  back: () => WorkspaceNavLocation | null;
  forward: () => WorkspaceNavLocation | null;
  clear: (initial?: WorkspaceNavLocation) => void;
  peek: (delta: number) => WorkspaceNavLocation | null;
};

const DEFAULT_LOCATION: WorkspaceNavLocation = { kind: "all" };

export function workspaceNavLocationsEqual(
  a: WorkspaceNavLocation,
  b: WorkspaceNavLocation,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  switch (a.kind) {
    case "all":
    case "root":
      return true;
    case "trash":
      return (
        a.tombstoneId ===
        (b as Extract<WorkspaceNavLocation, { kind: "trash" }>).tombstoneId
      );
    case "folder":
      return a.folderId === (b as Extract<WorkspaceNavLocation, { kind: "folder" }>).folderId;
    case "tag":
      return a.tagId === (b as Extract<WorkspaceNavLocation, { kind: "tag" }>).tagId;
    case "collection": {
      const other = b as Extract<WorkspaceNavLocation, { kind: "collection" }>;
      return a.collectionId === other.collectionId && a.recursive === other.recursive;
    }
    case "smart-collection":
      return (
        a.collectionId ===
        (b as Extract<WorkspaceNavLocation, { kind: "smart-collection" }>).collectionId
      );
    case "preview":
      return a.assetId === (b as Extract<WorkspaceNavLocation, { kind: "preview" }>).assetId;
    case "tag-management":
      return true;
  }
}

/**
 * 会话恢复的叶子位置种子（Serpent-ada7ad）：恢复进非 all scope 时以
 * {kind:"all"} 作为历史基底再 push 叶子，使「后退到全部资产」从第一帧即可用；
 * 恢复为 all 本身则保持单条、canBack=false。返回恢复后 canBack 是否应为 true。
 */
export function seedRestoreLeafLocation(
  history: WorkspaceNavHistory,
  restored: WorkspaceNavLocation,
): { canBack: boolean } {
  const baseIsAll = restored.kind === 'all';
  history.clear({ kind: 'all' });
  if (!baseIsAll) history.push(restored);
  return { canBack: !baseIsAll };
}

export function createWorkspaceNavHistory(
  initial: WorkspaceNavLocation = DEFAULT_LOCATION,
): WorkspaceNavHistory {
  const stack: WorkspaceNavLocation[] = [initial];
  let index = 0;

  const history: WorkspaceNavHistory = {
    current: initial,
    canBack: false,
    canForward: false,
    push(location) {
      if (workspaceNavLocationsEqual(history.current, location)) {
        return;
      }
      stack.length = index + 1;
      stack.push(location);
      index = stack.length - 1;
      history.current = location;
      history.canBack = index > 0;
      history.canForward = false;
    },
    replaceCurrent(location) {
      stack[index] = location;
      history.current = location;
    },
    dismissCurrent() {
      if (index <= 0) {
        return;
      }
      stack.splice(index, 1);
      index -= 1;
      history.current = stack[index]!;
      history.canBack = index > 0;
      history.canForward = false;
    },
    back() {
      if (index <= 0) {
        return null;
      }
      index -= 1;
      history.current = stack[index]!;
      history.canBack = index > 0;
      history.canForward = index < stack.length - 1;
      return history.current;
    },
    forward() {
      if (index >= stack.length - 1) {
        return null;
      }
      index += 1;
      history.current = stack[index]!;
      history.canBack = index > 0;
      history.canForward = index < stack.length - 1;
      return history.current;
    },
    clear(nextInitial = DEFAULT_LOCATION) {
      stack.length = 0;
      stack.push(nextInitial);
      index = 0;
      history.current = nextInitial;
      history.canBack = false;
      history.canForward = false;
    },
    peek(delta) {
      const target = index + delta;
      if (target < 0 || target >= stack.length) {
        return null;
      }
      return stack[target]!;
    },
  };

  return history;
}
