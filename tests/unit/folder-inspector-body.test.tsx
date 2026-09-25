// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { FolderBrowseEntry } from "../../src/shared/asset-types";
import { FolderInspectorBody } from "../../src/renderer/folder-inspector";
import { LocaleProvider } from "../../src/renderer/i18n";

function entry(overrides?: Partial<FolderBrowseEntry>): FolderBrowseEntry {
  return {
    folderId: "folder-1",
    parentFolderId: null,
    locationKind: "managed",
    name: "测试",
    relativePath: "测试",
    status: "available",
    directAssetCount: 19,
    recursiveAssetCount: 19,
    childFolderCount: 0,
    coverArtifactIds: [],
    coverAssetIds: [],
    linkedFolderId: null,
    ...overrides,
  };
}

function renderBody(entries: FolderBrowseEntry[], byteSize: number | null = 181534720): string {
  return renderToStaticMarkup(
    <LocaleProvider initialPreference="zh-CN">
      <FolderInspectorBody byteSize={byteSize} entries={entries} libraryId="lib-1" />
    </LocaleProvider>,
  );
}

describe("folder inspector body", () => {
  it("matches the asset inspector: name and label-left rows", () => {
    const html = renderBody([entry()]);
    expect(html).not.toContain(">文件夹<");
    expect(html).not.toContain("inspector-compact-info");
    expect(html).not.toContain("19 项");
    expect(html).toContain("nav-entity-glyph");
    expect(html).toContain("inspector-hero-title");
    expect(html).toContain("asset-filename-prefix");
    expect(html).toContain("inspector-raw-tech-label");
    expect(html).toContain("inspector-raw-tech-value");
    expect(html).toContain(">路径<");
    expect(html).toContain(">/根目录/测试<");
    expect(html).toContain(">测试<");
    expect(html).not.toContain("metadata-list");
    expect(html).not.toContain("micro-label");
  });
});
