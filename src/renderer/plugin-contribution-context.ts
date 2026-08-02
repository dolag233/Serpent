import type { AssetSummary } from "../shared/asset-types";
import {
  createPluginContributionContext,
  type PluginContributionContext,
} from "../plugins/plugin-context";
import type { ContextMenuDescriptor } from "./context-menu";

type MenuAsset = Pick<
  AssetSummary,
  "assetId" | "locationKind" | "availability" | "deletedAt" | "displayName" | "mediaType"
>;

const MIME_BY_MEDIA_TYPE: Record<AssetSummary["mediaType"], string> = {
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  text: "text/*",
  other: "application/octet-stream",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  txt: "text/plain",
  json: "application/json",
};

function extensionOf(name: string): string | undefined {
  const match = /\.([^.]+)$/u.exec(name);
  return match?.[1]?.toLowerCase();
}

function contextToken(values: readonly string[]): string {
  // Context IDs and selection refs are intentionally bounded by the shared
  // schema. Hash the potentially large selection instead of serializing all
  // selected IDs into a field whose size grows with the selection.
  let hash = 2166136261;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function selectedIds(descriptor: ContextMenuDescriptor): {
  assetIds: string[];
  folderIds: string[];
} {
  if (descriptor.type === "asset") return { assetIds: [descriptor.assetId], folderIds: [] };
  if (descriptor.type === "multi-asset") {
    return { assetIds: [...descriptor.assetIds], folderIds: [...(descriptor.folderIds ?? [])] };
  }
  if (descriptor.type === "folder" || descriptor.type === "trashed-folder") {
    return { assetIds: [], folderIds: [descriptor.type === "folder" ? descriptor.folderId : descriptor.tombstoneId] };
  }
  if (descriptor.type === "organization" || descriptor.type === "smart-collection") {
    return { assetIds: [], folderIds: [] };
  }
  if (descriptor.type === "workspace") return { assetIds: [...(descriptor.assetIds ?? [])], folderIds: [] };
  return { assetIds: [], folderIds: [] };
}

export function createPluginMenuContributionContext(input: {
  descriptor: ContextMenuDescriptor;
  assets: readonly MenuAsset[];
  libraryId?: string;
  locale?: string;
  theme?: "light" | "dark" | "system";
  revision?: number;
  browse?: Partial<PluginContributionContext["browse"]>;
  viewer?: Partial<PluginContributionContext["viewer"]>;
}): PluginContributionContext {
  const ids = selectedIds(input.descriptor);
  const assetsById = new Map(input.assets.map((asset) => [asset.assetId, asset]));
  const selectedAssets = ids.assetIds
    .map((assetId) => assetsById.get(assetId))
    .filter((asset): asset is MenuAsset => asset !== undefined);
  const fallbackName = input.descriptor.type === "asset" ? input.descriptor.displayName : "";
  const names = selectedAssets.length > 0
    ? selectedAssets.map((asset) => asset.displayName)
    : (fallbackName.length > 0 ? [fallbackName] : []);
  const extensions = [...new Set(names.map(extensionOf).filter((value): value is string => value !== undefined))];
  const mediaKinds = [...new Set(selectedAssets.map((asset) => asset.mediaType))];
  const mimeTypes = [...new Set(selectedAssets.flatMap((asset) => {
    const extension = extensionOf(asset.displayName);
    const exact = extension === undefined ? undefined : MIME_BY_EXTENSION[extension];
    return exact === undefined
      ? [MIME_BY_MEDIA_TYPE[asset.mediaType]]
      : [exact, MIME_BY_MEDIA_TYPE[asset.mediaType]];
  }))];
  const deletedCount = selectedAssets.filter((asset) => asset.deletedAt !== null).length;
  const unavailableCount = selectedAssets.filter((asset) => asset.availability !== "available").length;
  const managedCount = selectedAssets.filter((asset) => asset.locationKind === "managed").length;
  const refs = [...ids.assetIds, ...ids.folderIds];
  const selectionRef = refs.length > 0
    ? `selection:${refs.length}:${contextToken(refs)}`
    : undefined;
  const descriptorKey = input.descriptor.type === "workspace"
    ? "workspace"
    : input.descriptor.type;
  return createPluginContributionContext({
    contextId: `menu:${descriptorKey}:${refs.length}:${contextToken(refs)}`,
    revision: Math.max(1, input.revision ?? 1),
    app: {
      platform: navigator.platform || "unknown",
      locale: input.locale ?? (document.documentElement.lang || "en-US"),
      theme: input.theme ?? "system",
      busy: false,
    },
    surface: { id: `menus.${descriptorKey}`, kind: "context-menu" },
    window: { windowId: window.name || "main" },
    library: {
      ...(input.libraryId === undefined ? {} : { id: input.libraryId }),
      open: input.libraryId !== undefined,
      writable: input.libraryId !== undefined,
      offline: false,
    },
    selection: {
      ...(selectionRef === undefined ? {} : { ref: selectionRef }),
      count: refs.length,
      ...(ids.assetIds[0] === undefined ? {} : { primaryId: ids.assetIds[0] }),
      assetCount: ids.assetIds.length,
      folderCount: ids.folderIds.length,
      mixed: ids.assetIds.length > 0 && ids.folderIds.length > 0,
      extensions,
      mimeTypes,
      mediaKinds,
      summary: {
        managedCount,
        unmanagedCount: selectedAssets.length - managedCount,
        availableCount: selectedAssets.length - unavailableCount,
        unavailableCount,
        deletedCount,
        hasDeleted: deletedCount > 0,
        hasUnavailable: unavailableCount > 0,
      },
      hasDeleted: deletedCount > 0,
      hasUnavailable: unavailableCount > 0,
    },
    browse: input.browse ?? {},
    viewer: {
      active: input.viewer?.active ?? false,
      ...(input.viewer?.assetId === undefined ? {} : { assetId: input.viewer.assetId }),
      ...(input.viewer?.extension === undefined ? {} : { extension: input.viewer.extension }),
      ...(input.viewer?.mimeType === undefined ? {} : { mimeType: input.viewer.mimeType }),
      ...(input.viewer?.mediaKind === undefined ? {} : { mediaKind: input.viewer.mediaKind }),
      fullscreen: input.viewer?.fullscreen ?? false,
    },
  });
}
