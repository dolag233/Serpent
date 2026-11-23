import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import { THUMBNAIL_CHANNEL } from "../../src/shared/protocol/channels";

/** Exercise repeated native completions against a real asset in the disposable
 * catalog. Source files remain untouched; only its temporary tag is persisted.
 */
export async function probeDuplicateDimensions(
  application: ElectronApplication, window: Page, libraryId: string,
) {
  const asset = await window.evaluate(async (libraryId) => {
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    const found = await api.searchAssets({ libraryId, limit: 256 });
    if (!found.ok) throw new Error(found.error.code);
    const asset = found.value.items.find(item => item.mediaType === "image"
      && item.width && item.height && item.currentRevisionId);
    if (!asset) throw new Error("No measured real image available.");
    const tag = await api.createTag({ libraryId, name: "DimensionProbe" });
    if (!tag.ok) throw new Error(tag.error.code);
    const assigned = await api.assignTags({ libraryId, assetIds: [asset.assetId], tagIds: [tag.value.tagId] });
    if (!assigned.ok) throw new Error(assigned.error.code);
    return { assetId: asset.assetId, revisionId: asset.currentRevisionId!, width: asset.width!, height: asset.height! };
  }, libraryId);
  await window.getByRole("button", { name: "标签", exact: true }).hover();
  await window.locator(".filter-tag-expression-input textarea").fill("DimensionProbe");
  await window.keyboard.press("Escape");
  const card = window.locator(`.asset-card[data-asset-id="${asset.assetId}"]`);
  await expect(card).toBeVisible();
  await expect(window.locator(".asset-card")).toHaveCount(1);
  await expect.poll(() => card.locator("img").first().evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0)).toBe(true);
  const countRequests = () => window.evaluate(() =>
    (globalThis as typeof globalThis & {
      serpent: { e2e: { getRequestCount(type: string): number } };
    }).serpent.e2e.getRequestCount("folder.filtered-counts.request"));
  await expect.poll(countRequests).toBeGreaterThan(0);
  await window.waitForTimeout(500);
  const target = await application.browserWindow(window);
  try {
    const publish = (width: number) => target.evaluate((browserWindow, payload) => {
      browserWindow.webContents.send(payload.channel, payload.event);
    }, { channel: THUMBNAIL_CHANNEL, event: {
      type: "asset.dimensions.ready", libraryId, ...asset, width,
    } });
    // A first publication may still invalidate an older counts snapshot even
    // when a browse summary already carries the dimensions. Only repeats skip.
    await publish(asset.width);
    await window.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve()))));
    await window.waitForTimeout(250);
    const before = await countRequests();
    for (let index = 0; index < 10; index += 1) {
      await publish(asset.width);
      await window.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve()))));
    }
    await window.waitForTimeout(250);
    const afterDuplicates = await countRequests();
    expect(afterDuplicates - before, "same dimensions must not refresh filtered counts").toBe(0);
    await publish(asset.width + 1);
    await expect.poll(countRequests, { message: "a real dimension change must still refresh counts" })
      .toBeGreaterThan(afterDuplicates);
    const afterChanged = await countRequests();
    await publish(asset.width);
    await expect.poll(countRequests).toBeGreaterThan(afterChanged);
    return { duplicateEvents: 10, duplicateCountRequests: afterDuplicates - before,
      changedCountRequests: afterChanged - afterDuplicates };
  } finally {
    await target.dispose();
  }
}
