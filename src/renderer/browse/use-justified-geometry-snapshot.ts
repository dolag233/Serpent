import { useState } from "react";
import {
  updateJustifiedGeometrySnapshot,
  type JustifiedGeometrySnapshot,
} from "./justified-row-geometry";

type GeometryInput = Parameters<typeof updateJustifiedGeometrySnapshot>[0];

/** React owns both committed and provisional snapshots, including render rollback. */
export function useJustifiedGeometrySnapshot(input: GeometryInput | null): JustifiedGeometrySnapshot | null {
  const [snapshot, setSnapshot] = useState<JustifiedGeometrySnapshot | null>(
    () => input ? updateJustifiedGeometrySnapshot(input) : null,
  );
  const next = input ? updateJustifiedGeometrySnapshot(input, snapshot) : null;
  // Conditional render-phase adjustment retries this component before its
  // children render. An abandoned render never mutates a shared cache/ref.
  if (next !== snapshot) setSnapshot(next);
  return next;
}
