export interface NativeDragImage {
  isEmpty(): boolean;
  resize(options: { width: number; height: number }): NativeDragImage;
}

export interface NativeDragImageFactory {
  createFromPath(absolutePath: string): NativeDragImage;
}

export interface NativeAssetDragInfo {
  readonly assetId: string;
  readonly absolutePath: string;
  readonly thumbnailAbsolutePath?: string;
}

export class NativeAssetDragCache {
  private readonly entriesByLibrary = new Map<
    string,
    Map<string, NativeAssetDragInfo>
  >();

  replace(libraryId: string, entries: readonly NativeAssetDragInfo[]): void {
    this.entriesByLibrary.set(
      libraryId,
      new Map(entries.map((entry) => [entry.assetId, entry])),
    );
  }

  upsert(libraryId: string, entries: readonly NativeAssetDragInfo[]): void {
    const current = this.entriesByLibrary.get(libraryId) ?? new Map();
    for (const entry of entries) current.set(entry.assetId, entry);
    this.entriesByLibrary.set(libraryId, current);
  }

  clear(libraryId: string): void {
    this.entriesByLibrary.delete(libraryId);
  }

  entriesFor(
    libraryId: string,
    assetIds: readonly string[],
  ): readonly NativeAssetDragInfo[] | null {
    if (assetIds.length === 0) return null;
    const entries = this.entriesByLibrary.get(libraryId);
    if (!entries) return null;
    const resolved = assetIds.map((assetId) => entries.get(assetId));
    return resolved.some((entry) => !entry)
      ? null
      : (resolved as NativeAssetDragInfo[]);
  }
}

const NATIVE_DRAG_ICON_WIDTH = 96;
const NATIVE_DRAG_ICON_HEIGHT = 72;

function compactIcon(image: NativeDragImage | undefined): NativeDragImage | null {
  if (!image || image.isEmpty()) return null;
  const compact = image.resize({
    width: NATIVE_DRAG_ICON_WIDTH,
    height: NATIVE_DRAG_ICON_HEIGHT,
  });
  return compact.isEmpty() ? null : compact;
}

export function startNativeAssetDrag(input: {
  readonly cache: NativeAssetDragCache;
  readonly libraryId: string;
  readonly assetIds: readonly string[];
  readonly imageFactory: NativeDragImageFactory;
  readonly fallbackIcon: () => NativeDragImage | undefined;
  readonly startDrag: (options: {
    readonly file: string;
    readonly files: readonly string[];
    readonly icon: NativeDragImage;
  }) => void;
}): boolean {
  const entries = input.cache.entriesFor(input.libraryId, input.assetIds);
  if (!entries) return false;

  let icon: NativeDragImage | null = null;
  const primary = entries[0]!;
  // WebP should decode through Electron, but a source-image retry keeps the
  // native drag recognizable on a runtime that lacks a particular derived
  // thumbnail codec. Video posters are JPEG and therefore normally succeed on
  // the first attempt; unsupported source formats still fall through safely.
  const candidatePaths = [primary.thumbnailAbsolutePath, primary.absolutePath]
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate, index, paths) => paths.indexOf(candidate) === index);
  for (const candidatePath of candidatePaths) {
    try {
      icon = compactIcon(input.imageFactory.createFromPath(candidatePath));
    } catch {
      icon = null;
    }
    if (icon) break;
  }
  icon ??= compactIcon(input.fallbackIcon());
  if (!icon) return false;

  input.startDrag({
    file: entries[0]!.absolutePath,
    files: entries.map((entry) => entry.absolutePath),
    icon,
  });
  return true;
}
