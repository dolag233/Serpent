import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

function contrastRatio(foreground: string, background: string): number {
  const channels = (color: string) => {
    const hex = /^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(color)
      ? color.slice(1)
      : undefined;
    const hexChannels = hex
      ? hex.length === 3
        ? [...hex].map((channel) => `${channel}${channel}`)
        : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
      : undefined;
    const srgbChannels = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/iu
      .exec(color)
      ?.slice(1, 4)
      .map((channel) => Number(channel) * 255);
    const values = hexChannels
      ? hexChannels.map((channel) => Number.parseInt(channel, 16))
      : srgbChannels ?? color.match(/[\d.]+/gu)?.map(Number);
    if (!values || values.length < 3) {
      throw new Error(`Unsupported computed color: ${color}`);
    }
    return values.slice(0, 3).map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
  };
  const luminance = (color: string) => {
    const [red = 0, green = 0, blue = 0] = channels(color);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function readTypography(window: Page) {
  return window.evaluate(async () => {
    await document.fonts.ready;
    const computed = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing typography fixture: ${selector}`);
      }
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        family: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        letterSpacing: style.letterSpacing,
      };
    };
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      platform: document.documentElement.dataset.platform,
      theme: document.documentElement.dataset.theme,
      rootFamily: rootStyle.fontFamily,
      paneColor: rootStyle.getPropertyValue("--pane").trim(),
      raisedColor: rootStyle.getPropertyValue("--raised").trim(),
      textRendering: rootStyle.textRendering,
      badge: computed(".inspector-badge"),
      identityTitleContainer: computed(".inspector-identity strong"),
      identityTitle: computed(".inspector-identity-name"),
      microLabel: computed(".inspector-content .micro-label"),
      metadata: computed(".metadata-list dt"),
      metadataCount: computed(".metadata-list dd.mono"),
      navHeading: computed(".nav-section-heading"),
      navCount: computed(".nav-count"),
      menuSection: computed(".library-switcher-section-label, .library-switcher-item"),
    };
  });
}

test("uses coherent Windows UI fonts and readable caption sizes", async (
  { browserName },
  testInfo,
) => {
  test.skip(process.platform !== "win32", "Windows typography evidence");
  expect(browserName).toBe("chromium");

  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-windows-typography-"),
  );
  const sourcePath = path.join(temporaryRoot, "typo.png");
  writeFileSync(sourcePath, Buffer.from("PNG-typography"));
  const libraryName = "设计资源库";
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  let application: ElectronApplication | undefined;

  try {
    application = await electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath: resolveElectronExecutablePath(),
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        // 导入 1 资产让 Inspector 有内容（micro-label 等字段只随资产渲染）
        SERPENT_E2E_IMPORT_FILES: sourcePath,
      },
    });
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    const libraryTrigger = window.getByRole("button", {
      name: `当前资源库 ${libraryName}`,
    });
    await libraryTrigger.click();
    await expect(window.locator(".library-switcher-menu .library-switcher-item").first()).toBeVisible();

    const typography = await readTypography(window);

    expect(typography.platform).toBe("windows");
    // E2E 主题解析走系统偏好（preload 的 __SERPENT_E2E_THEME__ 注入在隔离
    // world，主 world 读不到）——按系统断言，而非写死 dark。
    const expectedTheme = await window.evaluate(() =>
      globalThis.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark",
    );
    expect(typography.theme).toBe(expectedTheme);
    expect(typography.rootFamily).toContain("HarmonyOS Sans SC");
    expect(typography.rootFamily).toContain("Segoe UI Variable");
    expect(typography.rootFamily.indexOf("HarmonyOS Sans SC")).toBeLessThan(
      typography.rootFamily.indexOf("Segoe UI Variable"),
    );
    expect(typography.rootFamily).toContain("Microsoft YaHei UI");
    expect(typography.rootFamily).toContain("Noto Sans SC Variable");
    expect(typography.textRendering).toBe("auto");
    expect(typography.badge.family).toContain("HarmonyOS Sans SC");
    expect(typography.identityTitle.family).toContain("HarmonyOS Sans SC");
    expect(typography.identityTitleContainer.family).toContain(
      "HarmonyOS Sans SC",
    );
    expect(typography.microLabel.family).toContain("HarmonyOS Sans SC");
    expect(typography.metadataCount.family).toContain("HarmonyOS Sans SC");
    expect(typography.badge.size).toBe("13px");
    expect(typography.badge.weight).toBe("400");
    expect(typography.identityTitle.size).toBe("13px");
    expect(typography.identityTitle.weight).toBe("560");
    expect(typography.microLabel.size).toBe("12px");
    expect(Number.parseFloat(typography.microLabel.letterSpacing)).toBeLessThanOrEqual(
      0.25,
    );
    expect(typography.metadata.size).toBe("12px");
    expect(typography.navHeading.size).toBe("12px");
    expect(typography.navCount.size).toBe("12px");
    expect(typography.menuSection.size).toBe("12px");
    expect(contrastRatio(typography.microLabel.color, typography.paneColor)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrastRatio(typography.badge.color, typography.badge.backgroundColor),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(typography.navHeading.color, typography.paneColor)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(typography.menuSection.color, typography.raisedColor)).toBeGreaterThanOrEqual(
      4.5,
    );

    const longNameFixture = await window.evaluate(() => {
      const container = document.querySelector(".inspector-identity strong");
      const name = document.querySelector(".inspector-identity-name");
      if (!(container instanceof HTMLElement) || !(name instanceof HTMLElement)) {
        throw new Error("Missing Inspector identity title fixture");
      }
      const originalName = name.textContent;
      const originalHeight = container.clientHeight;
      name.textContent = "设计资源库名称很长需要完整换行展示".repeat(3);
      const result = {
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        originalHeight,
        scrollWidth: container.scrollWidth,
        textOverflow: getComputedStyle(container).textOverflow,
        whiteSpace: getComputedStyle(container).whiteSpace,
        containerFamily: getComputedStyle(container).fontFamily,
        nameFamily: getComputedStyle(name).fontFamily,
      };
      name.textContent = originalName;
      return result;
    });
    expect(longNameFixture.scrollWidth).toBeLessThanOrEqual(
      longNameFixture.clientWidth + 1,
    );
    expect(longNameFixture.clientHeight).toBeGreaterThan(
      longNameFixture.originalHeight,
    );
    expect(longNameFixture.textOverflow).toBe("clip");
    expect(longNameFixture.whiteSpace).toBe("normal");
    expect(longNameFixture.containerFamily).toContain("HarmonyOS Sans SC");
    expect(longNameFixture.nameFamily).toContain("HarmonyOS Sans SC");

    const cdp = await window.context().newCDPSession(window);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    for (const selector of [
      ".inspector-content .micro-label",
      ".inspector-badge",
      ".inspector-identity-name",
      ".nav-section-heading",
      ".library-switcher-menu .library-switcher-item",
    ]) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      expect(
        fonts.some((font) => /HarmonyOS Sans SC/iu.test(font.familyName)),
        `${selector} should resolve through the HarmonyOS Sans SC font`,
      ).toBe(true);
    }
    const { nodeIds: metadataNodeIds } = await cdp.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: ".metadata-list dt, .metadata-list dd",
    });
    expect(metadataNodeIds).toHaveLength(6);
    for (const nodeId of metadataNodeIds) {
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      expect(
        fonts.some((font) => /HarmonyOS Sans SC/iu.test(font.familyName)),
        "every status/asset/folder label and value should use HarmonyOS",
      ).toBe(true);
    }

    const darkScreenshotPath = testInfo.outputPath(
      "windows-inspector-typography-dark.png",
    );
    await window.screenshot({ path: darkScreenshotPath });
    await testInfo.attach("windows-inspector-typography-dark", {
      path: darkScreenshotPath,
      contentType: "image/png",
    });
    const darkInspectorPath = testInfo.outputPath(
      "windows-inspector-identity-dark.png",
    );
    await window.locator(".inspector-content").screenshot({
      path: darkInspectorPath,
    });
    await testInfo.attach("windows-inspector-identity-dark", {
      path: darkInspectorPath,
      contentType: "image/png",
    });

    await window.evaluate(() => {
      localStorage.setItem(
        "serpent.theme-prefs.v1",
        JSON.stringify({ version: 1, theme: "light" }),
      );
    });
    await window.reload();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
    await window
      .getByRole("button", { name: `当前资源库 ${libraryName}` })
      .click();
    await expect(window.locator(".library-switcher-menu .library-switcher-item").first()).toBeVisible();

    const lightTypography = await readTypography(window);
    expect(lightTypography.theme).toBe("light");
    expect(lightTypography.microLabel.size).toBe("12px");
    expect(lightTypography.metadata.size).toBe("12px");
    expect(lightTypography.menuSection.size).toBe("12px");
    expect(
      contrastRatio(lightTypography.microLabel.color, lightTypography.paneColor),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        lightTypography.badge.color,
        lightTypography.badge.backgroundColor,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(lightTypography.navHeading.color, lightTypography.paneColor),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(lightTypography.menuSection.color, lightTypography.raisedColor),
    ).toBeGreaterThanOrEqual(4.5);

    const lightScreenshotPath = testInfo.outputPath(
      "windows-inspector-typography-light.png",
    );
    await window.screenshot({ path: lightScreenshotPath });
    await testInfo.attach("windows-inspector-typography-light", {
      path: lightScreenshotPath,
      contentType: "image/png",
    });
    const lightInspectorPath = testInfo.outputPath(
      "windows-inspector-identity-light.png",
    );
    await window.locator(".inspector-content").screenshot({
      path: lightInspectorPath,
    });
    await testInfo.attach("windows-inspector-identity-light", {
      path: lightInspectorPath,
      contentType: "image/png",
    });
  } finally {
    try {
      await application?.close();
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }
});
