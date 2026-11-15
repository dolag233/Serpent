// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RatingStars } from "../../src/renderer/RatingStars";
import { LocaleProvider } from "../../src/renderer/i18n";

it("previews the full range, restores the saved rating on leave and saves only on click", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  const render = (disabled = false) => act(() => root.render(createElement(LocaleProvider, null,
    createElement(RatingStars, { value: 3, disabled, onChange }))));
  const active = () => [...host.querySelectorAll(".rating-star")].map(el => el.hasAttribute("data-active"));
  try {
    await render();
    const stars = host.querySelectorAll<HTMLButtonElement>(".rating-star");
    await act(() => stars[3]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(active()).toEqual([true, true, true, true, false]);
    expect(stars[3]!.getAttribute("aria-pressed")).toBeNull();
    await act(() => stars[0]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(active()).toEqual([true, false, false, false, false]);
    expect(onChange).not.toHaveBeenCalled();
    await act(() => host.querySelector(".rating-stars")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(active()).toEqual([true, true, true, false, false]);
    await act(() => stars[3]!.click());
    expect(onChange).toHaveBeenCalledWith(4);
    await render(true);
    await act(() => stars[4]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(active()).toEqual([true, true, true, false, false]);
    await act(() => stars[4]!.click());
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally { await act(() => root.unmount()); host.remove(); }
});
