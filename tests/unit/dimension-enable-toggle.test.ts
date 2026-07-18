import { describe, expect, it, vi } from "vitest";

import { DimensionEnableToggle } from "../../src/renderer/dimension-enable-toggle";

describe("DimensionEnableToggle (REQ-FILTER-021)", () => {
  it("clears the live value and remembers it when toggled off from active", () => {
    const toggle = new DimensionEnableToggle<{ value: string }>();
    const apply = vi.fn();

    toggle.toggle(true, { value: "red" }, { value: "" }, apply);

    expect(apply).toHaveBeenCalledExactlyOnceWith({ value: "" });
  });

  it("restores the remembered value when toggled back on", () => {
    const toggle = new DimensionEnableToggle<{ value: string }>();
    const applyOff = vi.fn();
    const applyOn = vi.fn();

    toggle.toggle(true, { value: "red" }, { value: "" }, applyOff);
    toggle.toggle(false, { value: "" }, { value: "" }, applyOn);

    expect(applyOn).toHaveBeenCalledExactlyOnceWith({ value: "red" });
  });

  it("is a no-op when toggled with nothing remembered", () => {
    const toggle = new DimensionEnableToggle<{ value: string }>();
    const apply = vi.fn();

    toggle.toggle(false, { value: "" }, { value: "" }, apply);

    expect(apply).not.toHaveBeenCalled();
  });

  it("remembers a fresh value on each off-cycle rather than a stale one", () => {
    const toggle = new DimensionEnableToggle<{ value: string }>();
    const apply = vi.fn();

    toggle.toggle(true, { value: "red" }, { value: "" }, vi.fn());
    toggle.toggle(false, { value: "" }, { value: "" }, vi.fn());
    // User picked a new value while enabled, then disables again.
    toggle.toggle(true, { value: "blue" }, { value: "" }, vi.fn());
    toggle.toggle(false, { value: "" }, { value: "" }, apply);

    expect(apply).toHaveBeenCalledExactlyOnceWith({ value: "blue" });
  });

  it("clears the remembered value once consumed so a second restore is a no-op", () => {
    const toggle = new DimensionEnableToggle<{ value: string }>();
    const apply = vi.fn();

    toggle.toggle(true, { value: "red" }, { value: "" }, vi.fn());
    toggle.toggle(false, { value: "" }, { value: "" }, vi.fn());
    toggle.toggle(false, { value: "" }, { value: "" }, apply);

    expect(apply).not.toHaveBeenCalled();
  });
});
