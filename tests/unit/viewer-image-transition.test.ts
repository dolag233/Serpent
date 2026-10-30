// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { capturePhotoReturnFlight, cardPhotoRadius, containedPhotoRect, createPhotoFlight, movePhotoFlight, preparePhotoFlightSource, schedulePhotoFlightStart } from "../../src/renderer/viewer-image-transition";

describe("photo transition handoff", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
  it("uses the actual contained photo bounds rather than its letterboxed card", () => {
    const result = containedPhotoRect(new DOMRect(10, 20, 200, 200), 400, 200);
    expect([result.left, result.top, result.width, result.height]).toEqual([10, 70, 200, 100]);
  });
  it("inherits the card corners only where the photo touches them", () => {
    const card = document.createElement("div");
    card.style.borderRadius = "8px";
    card.getBoundingClientRect = () => new DOMRect(10, 20, 200, 200);
    document.body.append(card);
    expect(cardPhotoRadius(card, new DOMRect(10, 20, 200, 200))).toBe("8px 8px 8px 8px");
    expect(cardPhotoRadius(card, new DOMRect(10, 70, 200, 100))).toBe("0px 0px 0px 0px");
  });
  it.each([[3024, 4032], [3672, 4896], [6000, 8000], [12000, 16000], [12000, 4223]])("keeps a %dx%d photo flight within the window pixel budget", async (width, height) => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const image = document.createElement("img");
    image.className = "preview-image preview-image-full is-visible";
    Object.defineProperties(image, {
      complete: { value: true }, naturalWidth: { value: width }, naturalHeight: { value: height },
    });
    const clone = vi.spyOn(image, "cloneNode");
    const decode = vi.spyOn(image, "decode");
    const from = containedPhotoRect(new DOMRect(250, 10, 900, 600), width, height);
    const flight = createPhotoFlight(image, from)!;
    expect(flight).not.toBeNull();
    expect(flight.element).toBeInstanceOf(HTMLCanvasElement);
    const bitmap = flight.element as HTMLCanvasElement;
    expect(Math.max(bitmap.width, bitmap.height)).toBeLessThanOrEqual(2048);
    expect(Math.abs(bitmap.height - bitmap.width * height / width)).toBeLessThanOrEqual(1);
    expect(bitmap.className).toBe("viewer-photo-flight");
    expect(clone).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    const context = bitmap.getContext("2d")!;
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, bitmap.width, bitmap.height);
    bitmap.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    await movePhotoFlight(flight, from, new DOMRect(10, 20, 90, 120));
    expect(bitmap.animate).toHaveBeenCalledOnce();
  });
  it("hides full and placeholder layers without their normal 160ms crossfade delay", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/renderer/styles.css", "utf8");
    document.head.append(style);
    try {
      const viewer = document.createElement("div");
      viewer.className = "workspace-viewer is-photo-flight";
      viewer.innerHTML = '<img class="preview-image preview-image-full is-visible"><img class="preview-image preview-image-placeholder">';
      document.body.append(viewer);
      for (const image of viewer.querySelectorAll("img")) {
        expect(getComputedStyle(image).visibility).toBe("hidden");
        expect(getComputedStyle(image).transition).toBe("none");
      }
    } finally { style.remove(); }
  });
  it("keeps the islands toolbar in flex layout through viewing and restoring", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/renderer/styles.css", "utf8");
    document.head.append(style);
    const shell = document.createElement("div");
    shell.className = "app-shell";
    shell.dataset.shellLayout = "islands";
    shell.innerHTML = '<section class="workspace" data-photo-return="active"><div class="workspace-toolstrip is-viewing"><div class="workspace-bar"></div><div class="workspace-discovery"></div></div></section>';
    document.body.append(shell);
    const toolbar = shell.querySelector<HTMLElement>(".workspace-toolstrip")!;
    expect(getComputedStyle(toolbar).display).toBe("flex");
    toolbar.className = "workspace-toolstrip is-restoring";
    expect(getComputedStyle(toolbar).display).toBe("flex");
    toolbar.className = "workspace-toolstrip";
    shell.querySelector<HTMLElement>(".workspace")!.removeAttribute("data-photo-return");
    expect(getComputedStyle(toolbar).display).toBe("flex");
    style.remove();
  });
  it("keeps the decoded flight image mounted after animation until handoff removes it", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const source = document.createElement("img");
    Object.defineProperties(source, { complete: { value: true }, naturalWidth: { value: 400 } });
    source.src = "https://example.test/image.png";
    const from = new DOMRect(10, 20, 100, 80);
    const to = new DOMRect(50, 70, 400, 320);
    const flight = createPhotoFlight(source, from);
    expect(flight).not.toBeNull();
    const animation = { finished: Promise.resolve() };
    const animate = vi.fn((frames: Keyframe[] | PropertyIndexedKeyframes | null) => {
      void frames;
      return animation as unknown as Animation;
    });
    flight!.element.animate = animate;
    await movePhotoFlight(flight!, from, to, "8px", "0px");
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0]?.[0]).toMatchObject([
      { transform: "translate(0, 0) scale(1)", borderRadius: "8px" },
      { transform: "translate(40px, 50px) scale(4)", borderRadius: "0px" },
    ]);
    expect(flight!.element.isConnected).toBe(true);
    flight!.remove();
    expect(flight!.element.isConnected).toBe(false);
  });
  it("skips motion for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const source = document.createElement("img");
    Object.defineProperties(source, { complete: { value: true }, naturalWidth: { value: 400 } });
    expect(createPhotoFlight(source, new DOMRect(0, 0, 100, 100))).toBeNull();
  });
  it("reverses an unfinished opening from its painted frame without requiring a decoded viewer", async () => {
    const element = document.createElement("img");
    element.style.borderRadius = "4px";
    document.body.append(element);
    const from = new DOMRect(30, 40, 200, 160);
    element.getBoundingClientRect = () => from;
    Object.defineProperty(element, "offsetWidth", { value: 100 });
    const pause = vi.fn();
    const cancel = vi.fn();
    element.getAnimations = () => [{ pause, cancel } as unknown as Animation];
    const opening = { element, remove: () => element.remove() };
    const returning = capturePhotoReturnFlight(document.createElement("img"), opening)!;
    expect(returning.flight).toBe(opening);
    expect(returning.from).toBe(from);
    expect(returning.radius).toBe("8px");
    expect(pause).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(element.style.transform).toBe("none");
    expect(element.style.width).toBe("200px");
    const animate = vi.fn((frames: Keyframe[] | PropertyIndexedKeyframes | null) => {
      void frames;
      return { finished: Promise.resolve() } as unknown as Animation;
    });
    element.animate = animate;
    await movePhotoFlight(returning.flight, returning.from, new DOMRect(10, 20, 100, 80), returning.radius, "8px");
    expect(animate.mock.calls[0]?.[0]).toMatchObject([
      { transform: "translate(0, 0) scale(1)", borderRadius: "8px" },
      { transform: "translate(-20px, -20px) scale(0.5)", borderRadius: "16px" },
    ]);
    expect(element.isConnected).toBe(true);
  });
  it("captures the viewer before browse restoration can change its bounds", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const source = document.createElement("img");
    Object.defineProperties(source, { complete: { value: true }, naturalWidth: { value: 400 } });
    let rect = new DOMRect(30, 40, 400, 200);
    source.getBoundingClientRect = () => rect;
    const returning = capturePhotoReturnFlight(source, null)!;
    rect = new DOMRect(0, 0, 0, 0);
    expect(returning.from.width).toBe(400);
    // An empty/deferred card image is unnecessary for contain-fit geometry.
    expect(containedPhotoRect(new DOMRect(10, 20, 100, 100), returning.from.width, returning.from.height).height).toBe(50);
    expect(returning.flight.element.style.left).toBe("30px");
  });
  it("waits for a first-load cover to decode before capturing its pixels", async () => {
    const image = document.createElement("img");
    Object.defineProperties(image, { complete: { configurable: true, value: false }, naturalWidth: { configurable: true, value: 0 } });
    let decoded!: () => void;
    image.decode = () => new Promise<void>((resolve) => { decoded = resolve; });
    const result = preparePhotoFlightSource(image, new AbortController().signal);
    let done = false;
    void result.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 384 } });
    decoded();
    expect(await result).toBe(true);
  });
  it("cancels pending thumbnail preparation when another navigation wins", async () => {
    const image = document.createElement("img");
    image.decode = () => new Promise<void>(() => undefined);
    const controller = new AbortController();
    const result = preparePhotoFlightSource(image, controller.signal);
    controller.abort();
    expect(await result).toBe(false);
  });
  it("retries a missing opening layout and stops retrying after cancellation", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const start = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    schedulePhotoFlightStart(() => true, start);
    frames.shift()!(0);
    frames.shift()!(16);
    expect(start).toHaveBeenCalledTimes(3);
    expect(frames).toHaveLength(0);
    const pending = vi.fn(() => false);
    const cancel = schedulePhotoFlightStart(() => true, pending);
    cancel();
    frames.shift()!(32);
    expect(pending).toHaveBeenCalledOnce();
  });
  it("reuses the small opening raster when closing a large original", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const image = document.createElement("img");
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 12000 }, naturalHeight: { value: 4223 } });
    image.getBoundingClientRect = () => new DOMRect(100, 100, 900, 316.725);
    const raster = document.createElement("canvas");
    raster.width = 512;
    raster.height = 180;
    const returning = capturePhotoReturnFlight(image, null, raster)!;
    expect(returning).not.toBeNull();
    expect((returning.flight.element as HTMLCanvasElement).getContext("2d")!.drawImage).toHaveBeenCalledWith(raster, 0, 0, 512, 180);
  });
  it("preserves the zoomed viewport crop before revealing the full photo on return", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const viewport = document.createElement("div");
    viewport.className = "preview-image-viewport";
    viewport.getBoundingClientRect = () => new DOMRect(100, 80, 600, 400);
    const image = document.createElement("img");
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 12000 }, naturalHeight: { value: 4223 } });
    image.getBoundingClientRect = () => new DOMRect(-200, -120, 1200, 800);
    viewport.append(image);
    document.body.append(viewport);
    const returning = capturePhotoReturnFlight(image, null)!;
    expect(returning.flight.element.style.clipPath).toBe("");
    const clip = returning.flight.clip!;
    expect(clip.from).toEqual(new DOMRect(100, 80, 600, 400));
    expect(clip.element.style.clipPath).toBe(`inset(80px ${innerWidth - 700}px ${innerHeight - 480}px 100px)`);
    expect(returning.flight.element.parentElement).toBe(clip.element);
    const animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    returning.flight.element.animate = animate;
    const animateClip = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    clip.element.animate = animateClip;
    await movePhotoFlight(returning.flight, returning.from, new DOMRect(100, 100, 120, 80));
    expect(animateClip).toHaveBeenCalledWith([
      { clipPath: `inset(80px ${innerWidth - 700}px ${innerHeight - 480}px 100px)` },
      { clipPath: `inset(100px ${innerWidth - 220}px ${innerHeight - 180}px 100px)` },
    ], expect.anything());
    expect(animate).toHaveBeenCalledOnce();
    returning.flight.remove();
    expect(clip.element.isConnected).toBe(false);
    expect(returning.flight.element.isConnected).toBe(false);
  });
});
