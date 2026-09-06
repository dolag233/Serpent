import { describe, expect, it } from "vitest";

import { parseSearchExpression } from "../../src/shared/search-expression";
import {
  folderSearchTerms,
  resolveSearchFolderResults,
  type FolderSearchResult,
} from "../../src/renderer/search-folder-results";
import type {
  LinkedFolderSummary,
  ManagedFolderSummary,
} from "../../src/shared/asset-types";

const folders: ManagedFolderSummary[] = [
  {
    folderId: "f-hero",
    parentFolderId: null,
    name: "Hero Concepts",
    relativePath: "",
    directAssetCount: 0,
    childFolderCount: 2,
  },
  {
    folderId: "f-backup",
    parentFolderId: null,
    name: "backups",
    relativePath: "characters/monster/backups",
    directAssetCount: 0,
    childFolderCount: 0,
  },
];

const linkedFolders: LinkedFolderSummary[] = [
  {
    folderId: "l-tex",
    displayName: "Reference",
    status: "available",
    assetCount: 4,
    absoluteRootPath: "/Volumes/ref",
    linkedFolderId: "l-tex",
    relativePath: "textures",
  },
];

describe("folderSearchTerms", () => {
  it("collects plain-text, name, and path terms", () => {
    expect(
      folderSearchTerms(parseSearchExpression('hero name:"concept" path:maps')),
    ).toEqual(["hero", "concept", "maps"]);
  });

  it("ignores tag/description/author clauses and excluded terms", () => {
    expect(
      folderSearchTerms(parseSearchExpression("hero -backup tag:red author:Jane")),
    ).toEqual(["hero"]);
  });

  it("is empty when only non-folder fields are searched", () => {
    expect(folderSearchTerms(parseSearchExpression("tag:red"))).toEqual([]);
  });

  it("normalizes and dedupes terms", () => {
    expect(folderSearchTerms(parseSearchExpression("Hero HERO"))).toEqual([
      "hero",
    ]);
  });
});

describe("resolveSearchFolderResults", () => {
  it("matches a managed folder by name", () => {
    const results = resolveSearchFolderResults({
      query: parseSearchExpression("concept"),
      folders,
      linkedFolders,
    });
    expect(results.map((r) => r.folderId)).toEqual(["f-hero"]);
  });

  it("matches a folder by its relative sub-path", () => {
    const results = resolveSearchFolderResults({
      query: parseSearchExpression("monster"),
      folders,
      linkedFolders,
    });
    expect(results.map((r) => r.folderId)).toEqual(["f-backup"]);
  });

  it("matches a linked folder by display name and path", () => {
    const byName = resolveSearchFolderResults({
      query: parseSearchExpression("reference"),
      folders,
      linkedFolders,
    });
    const byPath = resolveSearchFolderResults({
      query: parseSearchExpression("textures"),
      folders,
      linkedFolders,
    });
    expect(byName.map((r) => r.folderId)).toEqual(["l-tex"]);
    expect(byPath.map((r) => r.folderId)).toEqual(["l-tex"]);
  });

  it("marks the location kind of every result", () => {
    const results = resolveSearchFolderResults({
      query: parseSearchExpression("hero"),
      folders,
      linkedFolders,
    });
    const kinds = results.reduce<Record<FolderSearchResult["locationKind"], number>>(
      (acc, r) => {
        acc[r.locationKind] += 1;
        return acc;
      },
      { managed: 0, linked: 0 },
    );
    expect(kinds.managed).toBe(1);
    expect(kinds.linked).toBe(0);
  });

  it("returns nothing for an empty or non-folder query", () => {
    expect(
      resolveSearchFolderResults({
        query: parseSearchExpression(""),
        folders,
        linkedFolders,
      }),
    ).toEqual([]);
    expect(
      resolveSearchFolderResults({
        query: parseSearchExpression("tag:red"),
        folders,
        linkedFolders,
      }),
    ).toEqual([]);
  });

  it("caps results at the configured limit", () => {
    const many = folders.map<ManagedFolderSummary>((f, index) => ({
      ...f,
      folderId: `dup-${index}`,
    }));
    const results = resolveSearchFolderResults({
      query: parseSearchExpression("a"),
      folders: many,
      linkedFolders,
      limit: 1,
    });
    expect(results.length).toBe(1);
  });
});