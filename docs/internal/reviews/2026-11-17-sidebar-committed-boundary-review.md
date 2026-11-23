# Sidebar committed-boundary review

Date: 2026-11-17

Scope: `src/renderer/navigation-sidebar-boundary.tsx`, the `App.tsx` boundary substitution, `nav-tree-disclosure.tsx` and its three `NavigationSidebar` call sites, plus the focused Renderer tests. This review excludes other accumulated worktree changes.

## Conclusion

No confirmed Standards or Spec blocker was found. The boundary uses default `React.memo` equality for the complete data props and stable forwarding functions for callback props. The forwarders read only the latest committed props, and old callback closures are fenced by a per-library scope object, so an A→B→A transition cannot revive the first A wrapper. Disclosure extraction preserves the existing button behavior.

This is a static review, not an independent test or application run. The root agent reports 57 focused Renderer tests passing across five files and zero targeted ESLint errors, with one existing App dependency warning. The current build's A journey and final prearmed library-switch result were still pending at review time. No foreground application interaction was performed, as requested.

## Standards review

- `NavigationSidebarBoundary` memoizes `NavigationSidebar` without a custom comparator (`navigation-sidebar-boundary.tsx:3`). All non-function props pass through unchanged. A changed data reference or primitive remains visible to React's default shallow comparison; the wrapper does not hide changes to the folder tree, selection, counts, filter state, or library.
- Callback names are derived from the function-valued top-level props, and stable wrappers dispatch through `committed.current` (`navigation-sidebar-boundary.tsx:23-37`). Optional callbacks remain absent when absent in the incoming props. Removed callbacks on an old wrapper resolve to the safe fallback. The special fallbacks match the synchronous drag-query APIs and the Promise-returning asset-drop resolver (`navigation-sidebar-boundary.tsx:7-12`).
- Scope is React-owned state, updated by a conditional same-component render retry when `libraryId` changes (`navigation-sidebar-boundary.tsx:20-22`). `useMemo` only optimizes the forwarding-wrapper set; it does not define token lifetime. The only mutable ref write is in `useLayoutEffect` (`navigation-sidebar-boundary.tsx:40-46`); render does not read or write the ref. This keeps an abandoned suspended candidate from replacing the committed callback scope.
- Sidebar callbacks are used by event handlers, editor blur/pointer handlers, and drag/drop continuations. The delayed native-drop path calls the resolver and later dispatches through the captured wrappers; after a scope replacement those wrappers return safe fallbacks rather than forwarding to the replacement library. The folder inline-edit hook also has its own `LibraryViewSessionToken` guard (`use-inline-folder-edit.ts:162-181`). The sidebar's layout effect updates `folderTreeActionsRef`; it does not invoke a callback prop (`NavigationSidebar.tsx:1360-1366`).
- `NavTreeDisclosure` is a default-memoized leaf with the complete four-field prop comparison (`nav-tree-disclosure.tsx:5-29`). It retains the disclosure class, button type, accessible label/state, click propagation stop, and entity ID passed to the current toggle handler. Collection-search and inline-create expansion remain derived into the `expanded` prop (`NavigationSidebar.tsx:1369-1393, 2094-2101`).

## Spec traceability

| Requirement | Implementation | Automated evidence reported | Manual / platform evidence |
| --- | --- | --- | --- |
| Unrelated browse renders do not rerun the complete sidebar when all data props are unchanged. | `navigation-sidebar-boundary.tsx:3,19-47`; App uses the boundary at `App.tsx:14774`. | Boundary tests cover stable inner props and latest callback dispatch (`navigation-sidebar-boundary.test.tsx:145-170`), and data identity/primitive changes (`:172-194`). Root reports the focused suite green. | No foreground interaction; expressly prohibited for this work. |
| Current committed callbacks remain callable without stale closure behavior; abandoned renders do not publish handlers. | Commit-time ref update and scope check at `navigation-sidebar-boundary.tsx:28-45`. | Suspended transition and abandoned suspended library-switch cases (`navigation-sidebar-boundary.test.tsx:286-365`); real folder click uses the replacement callback (`navigation-sidebar.test.ts:186-197`). | No independent manual run. |
| A delayed action from a replaced library cannot mutate the library returned to later. | Scope identity is captured by each wrapper set and checked before dispatch (`navigation-sidebar-boundary.tsx:21,28-37`). | A→B→A stale callback test (`navigation-sidebar-boundary.test.tsx:197-256`) and actual pending trash-drop test (`navigation-sidebar.test.ts:200-233`). Root reports both pass. | Current-build prearmed switch journey was pending; not claimed as passed here. |
| Disclosure remains accessible and functional while avoiding repeated chevron rendering on unrelated parent renders. | `nav-tree-disclosure.tsx:5-29`; uses at `NavigationSidebar.tsx:2142,2257,2627`. | Memo bailout, changed callback/state/label, and non-bubbling click (`nav-tree-disclosure.test.tsx:28-67`); existing tree fold tests remain. | No independent visual or keyboard acceptance. |

## Limits and measurement

The React-owned scope changes when the `libraryId` prop changes; a normal close publishes `library=null`, and A→B→A creates distinct scope objects. The boundary does not receive App's separate library-view generation, however. During a transition, `beginLibraryTransition` can advance that generation while the old library prop remains committed until the replacement or close is published. Consequently, this boundary does not promise to invalidate callbacks at transition start; its verified guarantee is after a different library scope is committed. A same-ID reinitialization with no intervening `libraryId` change would also require an explicit session token to be distinguished. This is a limitation, not a demonstrated cross-library mutation in the reviewed evidence.

The optimization still depends on data prop identities remaining stable. Any genuine data change or freshly allocated data object correctly rerenders the full sidebar; no custom comparator suppresses that work.

The root agent reports a calibrated Precise result of `NavigationSidebar` renders falling from 49 to 4 for the measured interval, with `AppearanceGlyph` at 2, `Icon` at 13,017, and 23 row operations. These counters show a substantial reduction in Sidebar renders, but are not frame-time proof. The two ordinary B runs were reported at P95/max 34.1/44.7 and 39.5/54.7 ms, against a 33.8 ms P95 comparison and an earlier 36.7 ms baseline; those samples do not establish a stable frame improvement. The larger scrolling performance goal remains open.

**Review status: no confirmed blocker; not accepted.** The current-build A journey and final prearmed switch result were pending and must be recorded separately if completed. No backend behavior changed in this increment.

## Subsequent evidence recorded by root

After the static review, root completed the current-build A journey (1 passed /37.1 s) and prearmed restart/switch journeys A/B (1 passed /22.9 s and 1 passed /17.0 s). The target-library RAF/decode probe reached 90% at 809.2/517.0 ms; returned viewports decoded 24/24 and 25/25 images. These are root executions, not an independent rerun or foreground acceptance. Runtime inspection also confirmed the hidden benchmark uses disabled hardware acceleration and offscreen software compositing, so its frame values cannot stand in for production native-GPU performance. Full details and limitations are in the corresponding development record; the larger goal stays open.
