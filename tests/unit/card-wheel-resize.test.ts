// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardWheelResize } from "../../src/renderer/card-wheel-resize";

afterEach(() => vi.restoreAllMocks());

function fixture(initial = 200) {
  let size = initial;
  let tick!: FrameRequestCallback;
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { tick = callback; return 1; });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const read = vi.fn(() => [100, 150, 200, 250, 300, 350, 400]);
  const apply = vi.fn((next: number) => { size = next; });
  const wheel = new CardWheelResize(() => size, read, apply);
  return { wheel, read, apply, request, cancel, tick: () => tick(0) };
}

describe("frame-coalesced card sizing", () => {
  it("counts every notch while doing one width read and resize per frame", () => {
    const f = fixture();
    f.wheel.enqueue(-100, 10, 20);
    f.wheel.enqueue(-0.5, 30, 40);
    f.wheel.enqueue(-200, 50, 60);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.apply).not.toHaveBeenCalled();
    f.tick();
    expect(f.apply).toHaveBeenCalledExactlyOnceWith(350, 50, 60);
    f.wheel.enqueue(100, 70, 80);
    f.tick();
    expect(f.apply).toHaveBeenLastCalledWith(300, 70, 80);
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it("reverses queued direction without doing a redundant layout", () => {
    const f = fixture();
    f.wheel.enqueue(-100, 10, 20);
    f.wheel.enqueue(100, 10, 20);
    f.tick();
    expect(f.apply).not.toHaveBeenCalled();
  });

  it("clamps stops and cancels pending work on leaving the canvas", () => {
    const f = fixture(400);
    f.wheel.enqueue(-100, 1, 2);
    f.tick();
    expect(f.apply).not.toHaveBeenCalled();
    f.wheel.enqueue(100, 1, 2);
    f.wheel.cancel();
    expect(f.cancel).toHaveBeenCalledOnce();
    f.tick();
    expect(f.apply).not.toHaveBeenCalled();
  });

  it("does not schedule layout for empty or invalid wheel deltas", () => {
    const f = fixture();
    for (const delta of [0, NaN, Infinity]) f.wheel.enqueue(delta, 1, 2);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
});
