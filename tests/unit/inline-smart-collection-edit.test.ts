import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEW_SMART_COLLECTION_NAME,
  changeInlineSmartCollectionEditValue,
  failInlineSmartCollectionEdit,
  isSameInlineSmartCollectionEditSession,
  markInlineSmartCollectionEditSubmitting,
  resolveInlineSmartCollectionEditCommit,
  startInlineSmartCollectionCreate,
} from "../../src/renderer/inline-smart-collection-edit";

describe("startInlineSmartCollectionCreate", () => {
  it("prefills the default name so Enter accepts it and typing replaces it", () => {
    expect(startInlineSmartCollectionCreate()).toEqual({
      kind: "create",
      value: DEFAULT_NEW_SMART_COLLECTION_NAME,
      error: null,
      submitting: false,
    });
  });

  it("accepts a localized default name", () => {
    expect(startInlineSmartCollectionCreate("New smart collection")).toMatchObject({
      value: "New smart collection",
    });
  });
});

describe("changeInlineSmartCollectionEditValue", () => {
  it("updates the value and clears a previous inline failure", () => {
    const failed = failInlineSmartCollectionEdit(
      startInlineSmartCollectionCreate(),
      "保存智能合集前请先设置搜索词或至少一个过滤条件。",
    );
    const next = changeInlineSmartCollectionEditValue(failed, "科幻横版");
    expect(next).toMatchObject({ value: "科幻横版", error: null });
  });
});

describe("resolveInlineSmartCollectionEditCommit", () => {
  it("cancels a create whose value is blank instead of submitting", () => {
    const session = changeInlineSmartCollectionEditValue(
      startInlineSmartCollectionCreate(),
      "   ",
    );
    expect(resolveInlineSmartCollectionEditCommit(session)).toEqual({
      action: "cancel",
    });
  });

  it("submits the trimmed create name", () => {
    const session = changeInlineSmartCollectionEditValue(
      startInlineSmartCollectionCreate(),
      "  横版概念图 ",
    );
    expect(resolveInlineSmartCollectionEditCommit(session)).toEqual({
      action: "submit",
      name: "横版概念图",
    });
  });

  it("keeps editing when a request is already in flight", () => {
    const session = markInlineSmartCollectionEditSubmitting(
      startInlineSmartCollectionCreate(),
    );
    expect(resolveInlineSmartCollectionEditCommit(session)).toEqual({
      action: "keep-editing",
    });
  });
});

describe("markInlineSmartCollectionEditSubmitting / failInlineSmartCollectionEdit", () => {
  it("blocks duplicate submits and clears the error while in flight", () => {
    const failed = failInlineSmartCollectionEdit(
      startInlineSmartCollectionCreate(),
      "已存在同名文件夹或文件。",
    );
    const submitting = markInlineSmartCollectionEditSubmitting(failed);
    expect(submitting).toMatchObject({ submitting: true, error: null });
  });

  it("keeps the typed value and surfaces the reason so the row stays open", () => {
    const session = changeInlineSmartCollectionEditValue(
      startInlineSmartCollectionCreate(),
      "我的合集",
    );
    const failed = failInlineSmartCollectionEdit(
      markInlineSmartCollectionEditSubmitting(session),
      "保存智能合集前请先设置搜索词或至少一个过滤条件。",
    );
    expect(failed).toMatchObject({
      value: "我的合集",
      submitting: false,
      error: "保存智能合集前请先设置搜索词或至少一个过滤条件。",
    });
  });
});

describe("isSameInlineSmartCollectionEditSession", () => {
  it("matches create sessions regardless of value edits", () => {
    const a = startInlineSmartCollectionCreate();
    const edited = changeInlineSmartCollectionEditValue(a, "别的名字");
    expect(isSameInlineSmartCollectionEditSession(a, edited)).toBe(true);
  });
});
