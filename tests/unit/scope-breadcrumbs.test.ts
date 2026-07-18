import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocaleProvider, createTranslator, catalogs } from "../../src/renderer/i18n";
import {
  ScopeBreadcrumbs,
  buildScopeBreadcrumbSegments,
} from "../../src/renderer/ScopeBreadcrumbs";
import { ScopeHistoryButtons } from "../../src/renderer/ScopeHistoryButtons";

const t = createTranslator(catalogs["zh-CN"]);

function withLocale(node: ReactElement) {
  return createElement(LocaleProvider, {
    initialPreference: "zh-CN",
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    children: node,
  });
}

describe("buildScopeBreadcrumbSegments", () => {
  it("omits a leading library prefix and shows all-assets", () => {
    expect(
      buildScopeBreadcrumbSegments(
        {
          showTrash: false,
          activeTagLabel: null,
          activeCollectionLabel: null,
          activeSmartCollectionLabel: null,
          assetScope: "all",
          folderTrail: [],
        },
        t,
      ),
    ).toEqual([{ kind: "static", id: "all", label: "所有资产" }]);
  });

  it("builds clickable managed folder crumbs", () => {
    expect(
      buildScopeBreadcrumbSegments(
        {
          showTrash: false,
          activeTagLabel: null,
          activeCollectionLabel: null,
          activeSmartCollectionLabel: null,
          assetScope: "leaf",
          folderTrail: [
            { folderId: "root", name: "Root" },
            { folderId: "leaf", name: "Leaf" },
          ],
        },
        t,
      ),
    ).toEqual([
      { kind: "folder", id: "root", label: "Root", folderId: "root" },
      { kind: "folder", id: "leaf", label: "Leaf", folderId: "leaf" },
    ]);
  });

  it("falls back to linked folder label when there is no managed trail", () => {
    expect(
      buildScopeBreadcrumbSegments(
        {
          showTrash: false,
          activeTagLabel: null,
          activeCollectionLabel: null,
          activeSmartCollectionLabel: null,
          assetScope: "linked-1",
          folderTrail: [],
          linkedFolderLabel: "External shots",
        },
        t,
      ),
    ).toEqual([
      { kind: "static", id: "linked-1", label: "External shots" },
    ]);
  });
});

describe("ScopeHistoryButtons", () => {
  const noop = () => undefined;

  it("renders back/forward buttons with chevron glyphs", () => {
    const markup = renderToStaticMarkup(
      withLocale(
        createElement(ScopeHistoryButtons, {
          canBack: true,
          canForward: true,
          onBack: noop,
          onForward: noop,
        }),
      ),
    );
    expect(markup).toContain('class="scope-history"');
    expect(markup).toContain('aria-label="后退"');
    expect(markup).toContain('aria-label="前进"');
    // The product requirement is single-chevron (‹ ›) glyphs, not the
    // collapse-panel icons previously used.
    expect(markup).toContain('d="m15 18-6-6 6-6"');
    expect(markup).toContain('d="m9 18 6-6-6-6"');
  });

  it("disables each direction independently", () => {
    const markup = renderToStaticMarkup(
      withLocale(
        createElement(ScopeHistoryButtons, {
          canBack: false,
          canForward: true,
          onBack: noop,
          onForward: noop,
        }),
      ),
    );
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-label="后退"[^>]*disabled=""/);
    expect(markup).not.toMatch(/aria-label="前进"[^>]*disabled=""/);
  });
});

describe("ScopeBreadcrumbs", () => {
  it("renders the breadcrumb trail only, without history controls", () => {
    const markup = renderToStaticMarkup(
      withLocale(
        createElement(ScopeBreadcrumbs, {
          segments: [
            { kind: "folder", id: "root", label: "Root", folderId: "root" },
            { kind: "folder", id: "leaf", label: "Leaf", folderId: "leaf" },
          ],
          onNavigateFolder: () => undefined,
        }),
      ),
    );
    expect(markup).toContain('aria-label="当前浏览范围"');
    expect(markup).toContain("scope-breadcrumbs");
    expect(markup).not.toContain("scope-history");
    expect(markup).not.toContain("后退");
    expect(markup).not.toContain("前进");
    // Parent crumbs stay clickable; the last crumb is the current scope.
    expect(markup).toContain('class="scope-crumb-button"');
    expect(markup).toContain("is-current");
  });
});
