import type { RendererResult } from "../../shared/protocol/responses";
import type { WorkerCommand } from "../../shared/protocol/requests";

export type LibraryCommandBuildOutcome =
  | { kind: "result"; result: RendererResult }
  | { kind: "command"; command: WorkerCommand; clipboardStageDirectory?: string };
