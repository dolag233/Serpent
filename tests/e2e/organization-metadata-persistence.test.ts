import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test("persists organization and metadata across restart and surfaces optimistic-lock conflicts", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-organization-persistence-e2e-"),
  );
  const profilePath = path.join(temporaryRoot, "profile");
  const sourceRoot = path.join(temporaryRoot, "sources");
  const libraryName = "组织持久化验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(sourceRoot, "persistent-asset.txt");
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  writeFileSync(sourcePath, "persistent asset");

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_IMPORT_FILES: sourcePath,
      },
    });

  let application = await launch();
  try {
    let window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window.getByRole("button", {
      name: /persistent-asset\.txt/i,
    });
    await expect(assetCard).toBeVisible();

    // The sidebar no longer enumerates or creates tags (REQ-TAG-001); seed
    // the tag through the library API, then re-enter 所有资产 so the
    // Renderer refreshes its tag summaries for the menu picker.
    await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              createTag(input: {
                libraryId: string;
                name: string;
              }): Promise<{ ok: boolean }>;
            };
          };
        }
      ).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error("No open library");
      const created = await api.createTag({ libraryId, name: "持久标签" });
      if (!created.ok) throw new Error("Could not create tag fixture.");
    });
    await window.getByRole("button", { name: /所有资产/ }).click();

    await window.getByRole("button", { name: "添加合集" }).click();
    await window
      .getByPlaceholder("输入合集名称，回车创建")
      .fill("持久合集");
    await window
      .getByPlaceholder("输入合集名称，回车创建")
      .press("Enter");
    await expect(window.getByRole("button", { name: /持久合集/ })).toBeVisible();

    await window.getByRole("button", { name: /持久合集/ }).click();
    await window.getByRole("button", { name: "添加合集" }).click();
    await window
      .getByPlaceholder("输入子合集名称，回车创建")
      .fill("持久子合集");
    await window
      .getByPlaceholder("输入子合集名称，回车创建")
      .press("Enter");
    await expect(
      window.getByRole("button", { name: /持久子合集/ }),
    ).toBeVisible();
    await window.getByRole("button", { name: /所有资产/ }).click();

    await assetCard.click({ button: "right" });
    await window.getByRole("menuitem", { name: "添加标签…" }).click();
    await window
      .getByRole("option", { name: "持久标签" })
      .click();
    await expect(window.locator(".toast")).toContainText("标签已添加");
    await expect(window.locator(".tag-chip-name")).toContainText("持久标签");
    await assetCard.click({ button: "right" });
    await window
      .getByRole("menuitem", { name: "加入合集：持久子合集" })
      .click();
    await expect(window.locator(".toast")).toContainText("资产已加入合集");

    await assetCard.click();
    const descriptionInput = window.getByLabel("描述");
    const sourceUrlInput = window.getByLabel("源链接");
    const paletteInput = window.getByRole("textbox", {
      name: "人工色卡",
      exact: true,
    });

    await descriptionInput.fill("跨重启保存的资产描述");
    await descriptionInput.blur();
    await expect(window.getByText(/版本 1/)).toBeVisible();
    await sourceUrlInput.fill("https://example.com/persistent-asset");
    await sourceUrlInput.press("Enter");
    await expect(window.getByText(/版本 2/)).toBeVisible();
    await paletteInput.fill("#112233, #AABBCC");
    await paletteInput.press("Enter");
    await expect(window.getByText(/版本 3/)).toBeVisible();
    await expect(window.getByLabel("人工色卡预览").locator("span")).toHaveCount(
      2,
    );
    await window.getByRole("button", { name: "4 星" }).click();
    await expect(window.getByText(/版本 4/)).toBeVisible();
    await window.getByRole("button", { name: "标记喜欢" }).click();
    await expect(window.getByText(/版本 5/)).toBeVisible();
    await expect(window.getByRole("button", { name: "取消喜欢" })).toBeVisible();

    await application.close();

    application = await launch();
    window = await application.firstWindow();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    // The sidebar no longer enumerates tags (REQ-TAG-001); verify the tag
    // and its assignment survived the restart through the retained 标签过滤
    // entry instead.
    await window.getByText("筛选与排序", { exact: true }).click();
    await window.getByLabel("标签过滤").fill("持久标签");
    await window.getByRole("option", { name: /持久标签/ }).click();
    await expect(
      window.getByRole("button", { name: /persistent-asset\.txt/i }),
    ).toBeVisible();
    await window.getByRole("button", { name: /持久合集/ }).click();
    let restoredCard = window.getByRole("button", {
      name: /persistent-asset\.txt/i,
    });
    await expect(restoredCard).toBeVisible();
    await expect(
      window.getByRole("button", { name: /持久子合集/ }),
    ).toBeVisible();
    await window.getByRole("button", { name: /持久子合集/ }).click();
    restoredCard = window.getByRole("button", {
      name: /persistent-asset\.txt/i,
    });
    await expect(restoredCard).toBeVisible();
    await restoredCard.click();

    const restoredDescriptionInput = window.getByLabel("描述");
    const restoredSourceUrlInput = window.getByLabel("源链接");
    const restoredPaletteInput = window.getByRole("textbox", {
      name: "人工色卡",
      exact: true,
    });
    await expect(restoredDescriptionInput).toHaveValue("跨重启保存的资产描述");
    await expect(restoredSourceUrlInput).toHaveValue(
      "https://example.com/persistent-asset",
    );
    await expect(restoredPaletteInput).toHaveValue("#112233, #AABBCC");
    await expect(window.getByText(/版本 5/)).toBeVisible();
    await expect(window.getByLabel("人工色卡预览").locator("span")).toHaveCount(
      2,
    );
    await expect(window.getByRole("button", { name: "取消喜欢" })).toBeVisible();

    const assetId = await restoredCard.getAttribute("data-asset-id");
    expect(assetId).toBeTruthy();
    if (!assetId) throw new Error("Restored asset has no asset id");
    const restoredOrganization = await window.evaluate(async (targetAssetId) => {
      const api = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              listCollections(input: { libraryId: string }): Promise<{
                ok: boolean;
                value?: Array<{
                  collectionId: string;
                  parentId: string | null;
                  name: string;
                }>;
              }>;
              getAssetMetadata(input: {
                libraryId: string;
                assetId: string;
              }): Promise<{
                ok: boolean;
                value?: {
                  entityVersion: number;
                  rating: number;
                  favorite: boolean;
                };
              }>;
            };
          };
        }
      ).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!open.ok || !libraryId) throw new Error("No open library");
      const [collections, metadata] = await Promise.all([
        api.listCollections({ libraryId }),
        api.getAssetMetadata({ libraryId, assetId: targetAssetId }),
      ]);
      if (!collections.ok || !metadata.ok || !metadata.value) {
        throw new Error("Restored organization state is unavailable");
      }
      const parent = collections.value?.find(
        (collection) => collection.name === "持久合集",
      );
      const child = collections.value?.find(
        (collection) => collection.name === "持久子合集",
      );
      return {
        childParentId: child?.parentId,
        metadata: metadata.value,
        parentId: parent?.collectionId,
      };
    }, assetId);
    expect(restoredOrganization.parentId).toBeTruthy();
    expect(restoredOrganization.childParentId).toBe(
      restoredOrganization.parentId,
    );
    expect(restoredOrganization).toMatchObject({
      metadata: {
        entityVersion: 5,
        favorite: true,
        rating: 4,
      },
    });

    const competingWrite = await window.evaluate(async (targetAssetId) => {
      const api = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              getAssetMetadata(input: {
                libraryId: string;
                assetId: string;
              }): Promise<{
                ok: boolean;
                value?: { entityVersion: number };
                error?: { code: string; message: string };
              }>;
              setAssetMetadata(input: {
                libraryId: string;
                assetId: string;
                expectedVersion: number;
                description: string;
                sourcePageUrl: string;
                palette: string[];
              }): Promise<{
                ok: boolean;
                value?: {
                  entityVersion: number;
                  description: string | null;
                  sourcePageUrl: string | null;
                  palette: string | null;
                };
                error?: { code: string; message: string };
              }>;
            };
          };
        }
      ).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!open.ok || !libraryId) throw new Error("No open library");
      const current = await api.getAssetMetadata({
        libraryId,
        assetId: targetAssetId,
      });
      if (!current.ok || !current.value) {
        throw new Error(current.error?.message ?? "Metadata read failed");
      }
      return api.setAssetMetadata({
        libraryId,
        assetId: targetAssetId,
        expectedVersion: current.value.entityVersion,
        description: "另一客户端的最新描述",
        sourcePageUrl: "https://example.com/competing-write",
        palette: ["#010203", "#DDEEFF"],
      });
    }, assetId);
    expect(competingWrite.ok).toBe(true);
    expect(competingWrite.value?.entityVersion).toBe(6);

    await restoredDescriptionInput.fill("界面中的陈旧修改");
    await restoredDescriptionInput.blur();
    await expect(window.getByText("版本冲突", { exact: true })).toBeVisible();
    await expect(window.locator(".inline-error")).toContainText(
      "元数据已被其他操作修改",
    );

    const latestBeforeRefresh = await window.evaluate(async (targetAssetId) => {
      const api = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              getAssetMetadata(input: {
                libraryId: string;
                assetId: string;
              }): Promise<{
                ok: boolean;
                value?: {
                  entityVersion: number;
                  description: string | null;
                };
              }>;
            };
          };
        }
      ).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!open.ok || !libraryId) throw new Error("No open library");
      return api.getAssetMetadata({ libraryId, assetId: targetAssetId });
    }, assetId);
    expect(latestBeforeRefresh).toMatchObject({
      ok: true,
      value: {
        entityVersion: 6,
        description: "另一客户端的最新描述",
      },
    });

    await window.getByRole("button", { name: "刷新元数据" }).click();
    await expect(restoredDescriptionInput).toHaveValue("另一客户端的最新描述");
    await expect(restoredSourceUrlInput).toHaveValue(
      "https://example.com/competing-write",
    );
    await expect(restoredPaletteInput).toHaveValue("#010203, #DDEEFF");
    await expect(window.getByText(/版本 6/)).toBeVisible();
    await expect(window.getByText("版本冲突", { exact: true })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("switches Inspector assets without connection flashes or mixed metadata", async () => {
  type InspectorSwitchSnapshot = {
    description: string;
    forbiddenStatus: string | null;
    title: string;
  };

  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-inspector-switching-e2e-"),
  );
  const alphaSourcePath = path.join(temporaryRoot, "alpha-inspector.txt");
  const betaSourcePath = path.join(temporaryRoot, "beta-inspector.txt");
  const libraryName = "检查器切换验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(alphaSourcePath, "alpha");
  writeFileSync(betaSourcePath, "beta");

  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: [alphaSourcePath, betaSourcePath].join(
        path.delimiter,
      ),
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const alphaCard = window
      .locator(".asset-card")
      .filter({ hasText: "alpha-inspector.txt" });
    const betaCard = window
      .locator(".asset-card")
      .filter({ hasText: "beta-inspector.txt" });
    await expect(alphaCard).toBeVisible();
    await expect(betaCard).toBeVisible();

    const description = window.getByLabel("描述");
    await alphaCard.click();
    await expect(description).toBeVisible();
    await description.fill("ALPHA_METADATA_SENTINEL");
    await description.blur();
    await expect(window.getByText(/版本 1/)).toBeVisible();

    await betaCard.click();
    await expect(description).toBeVisible();
    await description.fill("BETA_METADATA_SENTINEL");
    await description.blur();
    await expect(window.getByText(/版本 1/)).toBeVisible();

    await alphaCard.click();
    await expect(description).toHaveValue("ALPHA_METADATA_SENTINEL");

    await window.evaluate(() => {
      const testWindow = globalThis as typeof globalThis & {
        __serpentInspectorSwitchTrace?: {
          disconnect: () => void;
          snapshots: InspectorSwitchSnapshot[];
        };
      };
      const snapshots: InspectorSwitchSnapshot[] = [];
      let animationFrame = 0;

      const recordSnapshot = () => {
        const inspector = document.querySelector<HTMLElement>(
          ".inspector-pane",
        );
        const observedText = document.body.innerText;
        const forbiddenStatus =
          observedText.match(
            /加载中(?:…|\.\.\.)?|正在同步资源库(?:…|\.\.\.)?|连接中(?:…|\.\.\.)?/,
          )?.[0] ?? null;
        const snapshot = {
          description:
            inspector?.querySelector<HTMLTextAreaElement>("#meta-desc")
              ?.value ?? "",
          forbiddenStatus,
          title:
            inspector
              ?.querySelector<HTMLElement>(".inspector-hero-title")
              ?.innerText.trim() ?? "",
        };
        const previous = snapshots.at(-1);
        if (
          !previous ||
          previous.description !== snapshot.description ||
          previous.forbiddenStatus !== snapshot.forbiddenStatus ||
          previous.title !== snapshot.title
        ) {
          snapshots.push(snapshot);
        }
      };

      const observer = new MutationObserver(recordSnapshot);
      observer.observe(document.body, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      const sampleFrames = () => {
        recordSnapshot();
        animationFrame = requestAnimationFrame(sampleFrames);
      };
      sampleFrames();
      testWindow.__serpentInspectorSwitchTrace = {
        disconnect: () => {
          observer.disconnect();
          cancelAnimationFrame(animationFrame);
          recordSnapshot();
        },
        snapshots,
      };
    });

    await betaCard.click();
    await alphaCard.click();
    await betaCard.click();
    await expect(description).toHaveValue("BETA_METADATA_SENTINEL");
    await expect(window.locator(".inspector-hero-title")).toHaveText(
      "beta-inspector.txt",
    );

    const snapshots = await window.evaluate(() => {
      const trace = (
        globalThis as typeof globalThis & {
          __serpentInspectorSwitchTrace?: {
            disconnect: () => void;
            snapshots: InspectorSwitchSnapshot[];
          };
        }
      ).__serpentInspectorSwitchTrace;
      if (!trace) throw new Error("Inspector switching trace was not installed");
      trace.disconnect();
      return trace.snapshots;
    });

    expect(
      snapshots.filter((snapshot) => snapshot.forbiddenStatus !== null),
    ).toEqual([]);
    expect(
      snapshots.filter(
        (snapshot) =>
          (snapshot.title === "alpha-inspector.txt" &&
            snapshot.description === "BETA_METADATA_SENTINEL") ||
          (snapshot.title === "beta-inspector.txt" &&
            snapshot.description === "ALPHA_METADATA_SENTINEL"),
      ),
    ).toEqual([]);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("assigns Inspector tag suggestions directly and hides tags after their final use is removed", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-inspector-tag-picker-e2e-"),
  );
  const profilePath = path.join(temporaryRoot, "profile");
  const libraryName = "检查器标签选择验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const alphaSourcePath = path.join(temporaryRoot, "tag-source-alpha.txt");
  const betaSourcePath = path.join(temporaryRoot, "tag-target-beta.txt");
  mkdirSync(profilePath);
  writeFileSync(alphaSourcePath, "alpha tag source");
  writeFileSync(betaSourcePath, "beta tag target");

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_IMPORT_FILES: [alphaSourcePath, betaSourcePath].join(
          path.delimiter,
        ),
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_USER_DATA_PATH: profilePath,
      },
    });

  let application = await launch();
  try {
    let window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const alphaCard = window
      .locator(".asset-card")
      .filter({ hasText: "tag-source-alpha.txt" });
    const betaCard = window
      .locator(".asset-card")
      .filter({ hasText: "tag-target-beta.txt" });
    await expect(alphaCard).toBeVisible();
    await expect(betaCard).toBeVisible();
    const alphaAssetId = await alphaCard.getAttribute("data-asset-id");
    const betaAssetId = await betaCard.getAttribute("data-asset-id");
    expect(alphaAssetId).toBeTruthy();
    expect(betaAssetId).toBeTruthy();
    if (!alphaAssetId || !betaAssetId) {
      throw new Error("Imported tag-picker assets have no asset ids.");
    }

    await window.evaluate(
      async ({ sourceAssetId, targetAssetId }) => {
        const api = (
          globalThis as typeof globalThis & {
            serpent: {
              library: {
                listOpen(): Promise<{
                  ok: boolean;
                  value?: Array<{ libraryId: string }>;
                }>;
                createTag(input: {
                  libraryId: string;
                  name: string;
                }): Promise<{
                  ok: boolean;
                  value?: { tagId: string };
                  error?: { message: string };
                }>;
                assignTags(input: {
                  libraryId: string;
                  assetIds: string[];
                  tagIds: string[];
                }): Promise<{ ok: boolean; error?: { message: string } }>;
              };
            };
          }
        ).serpent.library;
        const open = await api.listOpen();
        const libraryId = open.value?.[0]?.libraryId;
        if (!open.ok || !libraryId) throw new Error("No open library.");

        const createAssignedTag = async (name: string, assetId: string) => {
          const created = await api.createTag({ libraryId, name });
          if (!created.ok || !created.value) {
            throw new Error(created.error?.message ?? `Could not create ${name}.`);
          }
          const assigned = await api.assignTags({
            libraryId,
            assetIds: [assetId],
            tagIds: [created.value.tagId],
          });
          if (!assigned.ok) {
            throw new Error(
              assigned.error?.message ?? `Could not assign ${name}.`,
            );
          }
        };

        await createAssignedTag("常用标签甲", sourceAssetId);
        await createAssignedTag("常用标签乙", sourceAssetId);
        await createAssignedTag("常用标签丙", sourceAssetId);
        await createAssignedTag("待清理标签", targetAssetId);
      },
      { sourceAssetId: alphaAssetId, targetAssetId: betaAssetId },
    );

    // Restart so the Renderer reloads the tag summaries prepared through the
    // typed preload API, just as it would after reopening an existing library.
    await application.close();
    application = await launch();
    window = await application.firstWindow();

    const restoredBetaCard = window
      .locator(".asset-card")
      .filter({ hasText: "tag-target-beta.txt" });
    await expect(restoredBetaCard).toBeVisible();
    await restoredBetaCard.click();

    const inspector = window.locator(".inspector-pane");
    await expect(inspector.locator(".tag-chip-name")).toContainText(
      "待清理标签",
    );
    await inspector.getByRole("button", { name: "移除此标签" }).click();
    await expect(
      inspector.locator(".tag-chip-name", { hasText: "待清理标签" }),
    ).toHaveCount(0);

    const openTagPicker = async () => {
      await inspector.getByRole("button", { name: "添加标签" }).click();
      const input = inspector.getByRole("combobox", { name: "添加标签" });
      await expect(input).toBeFocused();
      return input;
    };

    let tagInput = await openTagPicker();
    await expect(inspector.getByRole("option", { name: /常用标签甲/ })).toBeVisible();
    await expect(inspector.getByRole("option", { name: /常用标签乙/ })).toBeVisible();
    await expect(inspector.getByRole("option", { name: /常用标签丙/ })).toBeVisible();
    await expect(inspector.getByRole("option", { name: /待清理标签/ })).toHaveCount(0);

    await tagInput.fill("待清理标签");
    await expect(inspector.getByRole("option", { name: /待清理标签/ })).toHaveCount(0);
    await tagInput.fill("");

    // A pointer click applies an existing suggestion immediately and closes
    // the input; no second Enter confirmation is required.
    await inspector.getByRole("option", { name: /常用标签甲/ }).click();
    await expect(inspector.getByRole("combobox", { name: "添加标签" })).toHaveCount(0);
    await expect(inspector.locator(".tag-chip-name")).toContainText(
      "常用标签甲",
    );

    // Keyboard navigation wraps consistently. Down selects the first option,
    // another Down selects the second, Up returns to the first, and Enter
    // applies that active option immediately.
    tagInput = await openTagPicker();
    const remainingOptions = inspector.getByRole("option");
    await expect(remainingOptions).toHaveCount(2);
    const firstRemainingName = await remainingOptions
      .first()
      .locator(".tag-suggestion-name")
      .innerText();
    await tagInput.press("ArrowDown");
    await expect(remainingOptions.first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tagInput.press("ArrowDown");
    await expect(remainingOptions.nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tagInput.press("ArrowUp");
    await expect(remainingOptions.first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tagInput.press("Enter");
    await expect(inspector.getByRole("combobox", { name: "添加标签" })).toHaveCount(0);
    await expect(
      inspector.locator(".tag-chip-name", { hasText: firstRemainingName }),
    ).toHaveCount(1);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
