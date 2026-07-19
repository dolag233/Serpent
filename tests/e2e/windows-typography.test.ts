import { mkdtempSync, rmSync } from "node:fs";
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
    const values = hexChannels
      ? hexChannels.map((channel) => Number.parseInt(channel, 16))
      : color.match(/[\d.]+/gu)?.map(Number);
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
        color: style.color,
        family: style.fontFamily,
        size: style.fontSize,
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
      yaheiAvailable: document.fonts.check(
        '12px "Microsoft YaHei UI"',
        "当前资源库",
      ),
      microLabel: computed(".inspector-content .micro-label"),
      metadata: computed(".metadata-list dt"),
      navHeading: computed(".nav-section-heading"),
      navCount: computed(".nav-count"),
      menuSection: computed(".library-switcher-section-label"),
    };
  });
}

test("uses native Windows UI fonts and readable caption sizes", async (
  { browserName },
  testInfo,
) => {
  test.skip(process.platform !== "win32", "Windows typography evidence");
  expect(browserName).toBe("chromium");

  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-windows-typography-"),
  );
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
      },
    });
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    const libraryTrigger = window.getByRole("button", {
      name: `当前资源库 ${libraryName}`,
    });
    await libraryTrigger.click();
    await expect(window.locator(".library-switcher-section-label").first()).toBeVisible();

    const typography = await readTypography(window);

    expect(typography.platform).toBe("windows");
    expect(typography.theme).toBe("dark");
    expect(typography.rootFamily).toContain("Segoe UI Variable");
    expect(typography.rootFamily).toContain("Microsoft YaHei UI");
    expect(typography.textRendering).toBe("auto");
    expect(typography.yaheiAvailable).toBe(true);
    expect(typography.microLabel.family).toContain("Segoe UI Variable");
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
    expect(contrastRatio(typography.navHeading.color, typography.paneColor)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(typography.menuSection.color, typography.raisedColor)).toBeGreaterThanOrEqual(
      4.5,
    );

    const cdp = await window.context().newCDPSession(window);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    for (const selector of [
      ".inspector-content .micro-label",
      ".metadata-list dt",
      ".nav-section-heading",
      ".library-switcher-section-label",
    ]) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      expect(
        fonts.some((font) => /Microsoft YaHei UI/iu.test(font.familyName)),
        `${selector} should resolve Chinese glyphs through Microsoft YaHei UI`,
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
    await expect(window.locator(".library-switcher-section-label").first()).toBeVisible();

    const lightTypography = await readTypography(window);
    expect(lightTypography.theme).toBe("light");
    expect(lightTypography.microLabel.size).toBe("12px");
    expect(lightTypography.metadata.size).toBe("12px");
    expect(lightTypography.menuSection.size).toBe("12px");
    expect(
      contrastRatio(lightTypography.microLabel.color, lightTypography.paneColor),
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
  } finally {
    try {
      await application?.close();
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }
});
