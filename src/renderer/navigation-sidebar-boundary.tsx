import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavigationSidebar, type NavigationSidebarProps } from "./NavigationSidebar";

const Sidebar = memo(NavigationSidebar);

/** Old asynchronous drops may outlive the library that received their event. */
function inactiveActionResult(action: string): unknown {
  if (action === "onResolveManagedAssetDrop") return Promise.resolve([]);
  if (action === "getManagedAssetDragIds" || action === "getManagedFolderDragIds") return null;
  if (action === "isInternalAssetDrag") return false;
  return undefined;
}

/**
 * Keep browse-only updates out of the directory tree. Data props retain their
 * original identities; event dispatch uses the latest committed handlers from
 * the same library, so delayed events cannot target its replacement.
 */
export function NavigationSidebarBoundary(props: NavigationSidebarProps) {
  const libraryId = props.library?.libraryId ?? null;
  const [scope, setScope] = useState(() => ({ libraryId }));
  if (scope.libraryId !== libraryId) setScope({ libraryId });
  const committed = useRef<{ scope: typeof scope; props: NavigationSidebarProps } | null>(null);
  const callbackNames = Object.keys(props)
    .filter((key) => typeof props[key as keyof NavigationSidebarProps] === "function")
    .sort()
    .join("\n");

  const actions = useMemo(() => Object.fromEntries(
    callbackNames.split("\n").filter(Boolean).map((key) => [key, (...args: unknown[]) => {
      const current = committed.current;
      if (!current || current.scope !== scope) return inactiveActionResult(key);
      const callback = current.props[key as keyof NavigationSidebarProps];
      return typeof callback === "function"
        ? Reflect.apply(callback, undefined, args)
        : inactiveActionResult(key);
    }]),
  ) as Partial<NavigationSidebarProps>, [callbackNames, scope]);

  useLayoutEffect(() => {
    const current = { scope, props };
    committed.current = current;
    return () => {
      if (committed.current === current) committed.current = null;
    };
  }, [scope, props]);

  return <Sidebar {...props} {...actions} />;
}
