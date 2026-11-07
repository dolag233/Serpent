import { describe, expect, it } from "vitest";
import { replaceTagExpressionTerm, tagExpressionTermAt } from "../../src/renderer/tag-expression-editor";

describe("tag expression editor source edits", () => {
  it("finds the atom at a caret inside quotes and replaces it exactly", () => {
    const source = 'hero -"blue sk" | monster';
    const caret = source.indexOf("sk") + 1;
    expect(tagExpressionTermAt(source, caret)?.value).toBe("blue sk");
    expect(replaceTagExpressionTerm(source, caret, "blue sky", "include").value)
      .toBe('hero "blue sky" | monster');
  });

  it("leaves an insertion point after replacing the final partial term", () => {
    expect(replaceTagExpressionTerm("角", 1, "角色", "include").value).toBe('"角色" ');
    expect(replaceTagExpressionTerm('"角色" ', 5, "临时", "exclude").value)
      .toBe('"角色" -"临时" ');
  });

  it("keeps parentheses inside a word with the parser's token boundary rules", () => {
    const source = "image(1).png";
    const caret = source.indexOf("1") + 1;
    expect(tagExpressionTermAt(source, caret)?.value).toBe(source);
    expect(replaceTagExpressionTerm(source, caret, "image(2).png", "include").value)
      .toBe('"image(2).png" ');
  });

  it("inserts an excluded exact tag when the caret has no atom", () => {
    expect(replaceTagExpressionTerm("hero | ", 7, "blue sky", "exclude").value)
      .toBe('hero | -"blue sky" ');
  });

  it("Shift-click accumulates an OR choice and Shift-right-click adds another exclusion", () => {
    expect(replaceTagExpressionTerm("wood", 4, "Wood", "include", true).value)
      .toBe('("wood" | "Wood") ');
    expect(replaceTagExpressionTerm('"Wood" ', 7, "Warm", "include", true).value)
      .toBe('("Wood" | "Warm") ');
    expect(replaceTagExpressionTerm('"A" -"D" ', 9, "B", "include", true).value)
      .toBe('("A" | "B") -"D" ');
    expect(replaceTagExpressionTerm('"Role"', 6, "Draft", "exclude", true).value)
      .toBe('"Role" -"Draft"');
  });
});
