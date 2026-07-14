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

    await window.getByRole("button", { name: "添加标签" }).click();
    await window
      .getByPlaceholder("输入标签名称，回车创建")
      .fill("持久标签");
    await window
      .getByPlaceholder("输入标签名称，回车创建")
      .press("Enter");
    await expect(window.getByRole("button", { name: /持久标签/ })).toBeVisible();

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
    await window
      .getByRole("menuitem", { name: "添加标签：持久标签" })
      .click();
    await expect(window.locator(".toast")).toContainText("标签已添加");
    await assetCard.click({ button: "right" });
    await window
      .getByRole("menuitem", { name: "加入合集：持久子合集" })
      .click();
    await expect(window.locator(".toast")).toContainText("资产已加入合集");

    await assetCard.click();
    const labelInput = window.getByLabel("标签 (Label)");
    const descriptionInput = window.getByLabel("描述");
    const sourceUrlInput = window.getByLabel("源链接 (URL)");
    const paletteInput = window.getByRole("textbox", {
      name: "人工色卡",
      exact: true,
    });

    await labelInput.fill("持久资产标签");
    await labelInput.press("Enter");
    await expect(window.getByText(/版本 1/)).toBeVisible();
    await descriptionInput.fill("跨重启保存的资产描述");
    await descriptionInput.blur();
    await expect(window.getByText(/版本 2/)).toBeVisible();
    await sourceUrlInput.fill("https://example.com/persistent-asset");
    await sourceUrlInput.press("Enter");
    await expect(window.getByText(/版本 3/)).toBeVisible();
    await paletteInput.fill("#112233, #AABBCC");
    await paletteInput.press("Enter");
    await expect(window.getByText(/版本 4/)).toBeVisible();
    await expect(window.getByLabel("人工色卡预览").locator("span")).toHaveCount(
      2,
    );
    await window.getByRole("button", { name: "4 星" }).click();
    await expect(window.getByText(/版本 5/)).toBeVisible();
    await window.getByRole("button", { name: "标记喜欢" }).click();
    await expect(window.getByText(/版本 6/)).toBeVisible();
    await expect(window.getByRole("button", { name: "取消喜欢" })).toBeVisible();

    await application.close();

    application = await launch();
    window = await application.firstWindow();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    await expect(window.getByRole("button", { name: /持久标签/ })).toBeVisible();
    await window.getByRole("button", { name: /持久标签/ }).click();
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

    const restoredLabelInput = window.getByLabel("标签 (Label)");
    const restoredDescriptionInput = window.getByLabel("描述");
    const restoredSourceUrlInput = window.getByLabel("源链接 (URL)");
    const restoredPaletteInput = window.getByRole("textbox", {
      name: "人工色卡",
      exact: true,
    });
    await expect(restoredLabelInput).toHaveValue("持久资产标签");
    await expect(restoredDescriptionInput).toHaveValue("跨重启保存的资产描述");
    await expect(restoredSourceUrlInput).toHaveValue(
      "https://example.com/persistent-asset",
    );
    await expect(restoredPaletteInput).toHaveValue("#112233, #AABBCC");
    await expect(window.getByText(/版本 6/)).toBeVisible();
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
        entityVersion: 6,
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
                label: string;
                description: string;
                sourcePageUrl: string;
                palette: string[];
              }): Promise<{
                ok: boolean;
                value?: {
                  entityVersion: number;
                  label: string | null;
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
        label: "另一客户端的最新标签",
        description: "另一客户端的最新描述",
        sourcePageUrl: "https://example.com/competing-write",
        palette: ["#010203", "#DDEEFF"],
      });
    }, assetId);
    expect(competingWrite.ok).toBe(true);
    expect(competingWrite.value?.entityVersion).toBe(7);

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
                  label: string | null;
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
        entityVersion: 7,
        label: "另一客户端的最新标签",
        description: "另一客户端的最新描述",
      },
    });

    await window.getByRole("button", { name: "刷新元数据" }).click();
    await expect(restoredLabelInput).toHaveValue("另一客户端的最新标签");
    await expect(restoredDescriptionInput).toHaveValue("另一客户端的最新描述");
    await expect(restoredSourceUrlInput).toHaveValue(
      "https://example.com/competing-write",
    );
    await expect(restoredPaletteInput).toHaveValue("#010203, #DDEEFF");
    await expect(window.getByText(/版本 7/)).toBeVisible();
    await expect(window.getByText("版本冲突", { exact: true })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
