import type { ComponentProps, Ref } from "react";
import { ContextMenu, ContextMenuBackdrop, ContextMenuItem, useContextMenu } from "./context-menu";
import { useT } from "./i18n";
import { formatRuntimeShortcut } from "./shortcut-runtime";

/** Blank tag space provides paste even when the asset has no tags yet. */
export function InspectorTagGrid({ ref, onPaste, children, ...props }: Omit<ComponentProps<"div">, "onPaste" | "ref"> & {
  ref: Ref<HTMLDivElement>;
  onPaste: () => void;
}) {
  const t = useT();
  const { active, open } = useContextMenu();
  const id = "inspector-tags-blank";
  return <>
    <div {...props} ref={ref} tabIndex={-1} onPointerDownCapture={event => {
      if (!(event.target as Element).closest("button, input, textarea")) event.currentTarget.focus({ preventScroll: true });
    }} onContextMenu={event => {
      if ((event.target as Element).closest(".inspector-tag-chip, input, textarea")) return;
      event.preventDefault();
      event.stopPropagation();
      open({ type: "organization", id, name: t("inspector.tags") }, { x: event.clientX, y: event.clientY });
    }}>{children}</div>
    {active?.descriptor.type === "organization" && active.descriptor.id === id &&
      <ContextMenuBackdrop><ContextMenu ariaLabel={t("inspector.tags")} position={active.position}>
        <ContextMenuItem label={t("inspector.pasteTags")} shortcut={formatRuntimeShortcut("asset.paste") ?? undefined} onAction={onPaste} />
      </ContextMenu></ContextMenuBackdrop>}
  </>;
}
