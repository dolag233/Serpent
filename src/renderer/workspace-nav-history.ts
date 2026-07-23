export type WorkspaceNavLocation =
  | { kind: "all" }
  | { kind: "root" }
  | { kind: "folder"; folderId: string }
  | { kind: "tag"; tagId: string }
  | { kind: "collection"; collectionId: string; recursive: boolean }
  | { kind: "smart-collection"; collectionId: string }
  | { kind: "trash"; tombstoneId: string | null };

export type WorkspaceNavHistory = {
  current: WorkspaceNavLocation;
  canBack: boolean;
  canForward: boolean;
  push: (location: WorkspaceNavLocation) => void;
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
  }
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
