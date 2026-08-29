import { describe, expect, it } from "vitest";

import { shouldShowApplyToRest } from "../../src/renderer/image-sequence-import-dialog";
import { en } from "../../src/renderer/i18n/catalogs/en";
import { zhCN } from "../../src/renderer/i18n/catalogs/zh-CN";

describe("image sequence import dialog", () => {
  it("hides apply-to-rest for a single sequence", () => {
    expect(shouldShowApplyToRest(0, 1)).toBe(false);
  });

  it("shows apply-to-rest only when a later sequence exists", () => {
    expect(shouldShowApplyToRest(0, 2)).toBe(true);
    expect(shouldShowApplyToRest(1, 2)).toBe(false);
  });

  it("rejects indexes outside the sequence list", () => {
    expect(shouldShowApplyToRest(-1, 2)).toBe(false);
    expect(shouldShowApplyToRest(2, 2)).toBe(false);
  });

  it("uses explicit individual-file and sequence actions", () => {
    expect(zhCN.dialog.imageSequenceImport.importSelected).toBe("导入单独文件");
    expect(zhCN.dialog.imageSequenceImport.importSequence).toBe("导入序列帧");
    expect(en.dialog.imageSequenceImport.importSelected).toBe("Import individual file");
    expect(en.dialog.imageSequenceImport.importSequence).toBe("Import image sequence");
  });
});
