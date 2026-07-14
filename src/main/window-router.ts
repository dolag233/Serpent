export interface WindowLibraryContext {
  libraryId: string | null;
  selectedFolderId?: string;
}

export interface RoutedWebContents {
  send(channel: string, payload: unknown): void;
}

export interface RoutedWindow {
  id: number;
  webContents: RoutedWebContents;
  isDestroyed(): boolean;
}

/**
 * Owns the security boundary between Electron WebContents instances and the
 * per-window library context. Keeping this class Electron-free makes routing
 * and reference-count behaviour independently testable.
 */
export class WindowRouter<TWindow extends RoutedWindow = RoutedWindow> {
  readonly #windows = new Map<number, TWindow>();
  readonly #windowIdsBySender = new Map<object, number>();
  readonly #contexts = new Map<number, WindowLibraryContext>();
  #lastFocusedWindowId: number | undefined;

  register(window: TWindow): void {
    this.#windows.set(window.id, window);
    this.#windowIdsBySender.set(window.webContents as object, window.id);
    this.#contexts.set(window.id, { libraryId: null });
    this.#lastFocusedWindowId = window.id;
  }

  unregister(windowId: number): WindowLibraryContext | undefined {
    const window = this.#windows.get(windowId);
    if (window) this.#windowIdsBySender.delete(window.webContents as object);
    this.#windows.delete(windowId);
    const context = this.#contexts.get(windowId);
    this.#contexts.delete(windowId);
    if (this.#lastFocusedWindowId === windowId) {
      this.#lastFocusedWindowId = [...this.#windows.keys()].at(-1);
    }
    return context;
  }

  windowForSender(sender: unknown): TWindow | undefined {
    if ((typeof sender !== 'object' && typeof sender !== 'function') || sender === null) return undefined;
    const windowId = this.#windowIdsBySender.get(sender as object);
    return windowId === undefined ? undefined : this.#windows.get(windowId);
  }

  window(windowId: number): TWindow | undefined {
    return this.#windows.get(windowId);
  }

  windows(): TWindow[] {
    return [...this.#windows.values()].filter((window) => !window.isDestroyed());
  }

  markFocused(windowId: number): void {
    if (this.#windows.has(windowId)) this.#lastFocusedWindowId = windowId;
  }

  lastFocusedWindow(): TWindow | undefined {
    const window = this.#lastFocusedWindowId === undefined
      ? undefined
      : this.#windows.get(this.#lastFocusedWindowId);
    if (window && !window.isDestroyed()) return window;
    return this.windows().at(-1);
  }

  context(windowId: number): WindowLibraryContext | undefined {
    const context = this.#contexts.get(windowId);
    return context ? { ...context } : undefined;
  }

  setContext(windowId: number, context: WindowLibraryContext): boolean {
    if (!this.#windows.has(windowId)) return false;
    this.#contexts.set(windowId, { ...context });
    return true;
  }

  clearLibrary(windowId: number): WindowLibraryContext | undefined {
    const previous = this.context(windowId);
    if (previous) this.#contexts.set(windowId, { libraryId: null });
    return previous;
  }

  windowIdsForLibrary(libraryId: string, excludingWindowId?: number): number[] {
    const matches: number[] = [];
    for (const [windowId, context] of this.#contexts) {
      if (windowId !== excludingWindowId && context.libraryId === libraryId && this.#windows.has(windowId)) {
        matches.push(windowId);
      }
    }
    return matches;
  }

  isLastReference(windowId: number, libraryId: string): boolean {
    return this.windowIdsForLibrary(libraryId, windowId).length === 0;
  }

  publishToWindow(windowId: number, channel: string, payload: unknown): boolean {
    const window = this.#windows.get(windowId);
    if (!window || window.isDestroyed()) return false;
    window.webContents.send(channel, payload);
    return true;
  }

  publishToLibrary(libraryId: string, channel: string, payload: unknown): number {
    let published = 0;
    for (const windowId of this.windowIdsForLibrary(libraryId)) {
      if (this.publishToWindow(windowId, channel, payload)) published += 1;
    }
    return published;
  }

  broadcast(channel: string, payload: unknown): number {
    let published = 0;
    for (const window of this.windows()) {
      window.webContents.send(channel, payload);
      published += 1;
    }
    return published;
  }
}
