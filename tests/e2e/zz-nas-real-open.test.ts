import { _electron as electron, expect, test } from "@playwright/test";
import {
  electronLaunchEnv,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 真实 NAS 冒烟测试：只在显式设置
// SERPENT_NAS_REAL_E2E=1 和 SERPENT_NAS_REAL_LIBRARY_PATH 时运行。
// 不保留任何默认的生产库路径，验证脚本应指向隔离的探针副本，
// 避免测试意外读取或写入用户数据。
const REAL_LIBRARY = process.env.SERPENT_NAS_REAL_LIBRARY_PATH
  ?.trim();
const NAS_REAL_ENABLED = process.env.SERPENT_NAS_REAL_E2E === "1" && Boolean(REAL_LIBRARY);

test.skip(
  !NAS_REAL_ENABLED,
  "real-NAS smoke test: set SERPENT_NAS_REAL_E2E=1 and SERPENT_NAS_REAL_LIBRARY_PATH to an isolated fixture",
);

test("real NAS library end-to-end open and browse", async () => {
  test.setTimeout(900_000);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-nas-real-"));
  const applicationDirectory = process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      SERPENT_E2E: "1",
      SERPENT_E2E_OPEN_LIBRARY_PATH: REAL_LIBRARY,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_WORKER_CMD_LOG: "1",
      SERPENT_OPEN_STAGE_LOG: "1",
      SERPENT_REFRESH_STAGE_LOG: "1",
    }),
  });
  try {
    const window = await application.firstWindow();
    await window.setViewportSize({ width: 1440, height: 1000 });
    const openLibrary = window.getByRole("button", { exact: true, name: "打开资源库" });
    await expect(openLibrary).toBeVisible({ timeout: 60_000 });
    const t0 = Date.now();
    await openLibrary.click();
    // 对话框被 E2E env 劫持 → 直接返回隔离探针库路径，进入打开流程
    await expect(window.locator(".asset-card").first()).toBeVisible({ timeout: 600_000 });
    console.log(`NAS_REAL first card after ${Date.now() - t0}ms`);
    const cards = await window.locator(".asset-card").count();
    console.log(`NAS_REAL cards=${cards}`);
    // 读取页面总资产数
    const total = await window.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-testid*='total']");
      return el?.textContent ?? "";
    });
    console.log(`NAS_REAL totalText=${total}`);
    // 滚动跳转到中部测缩略图解码。仅当运行环境能访问链接源时才有意义
    // （SERPENT_NAS_REAL_EXPECT_SOURCES=1，且探针库的源文件可访问）；
    // 源不可达的探针环境里缩略图注定 SOURCE_NOT_FOUND，不该据此判失败。
    if (process.env.SERPENT_NAS_REAL_EXPECT_SOURCES === "1") {
      const canvasEl = window.locator(".workspace-canvas");
      const scrollHeight = await canvasEl.evaluate((el) => el.scrollHeight);
      console.log(`NAS_REAL scrollHeight=${scrollHeight}`);
      await canvasEl.evaluate((el) => { el.scrollTop = el.scrollHeight * 0.5; });
      const t1 = Date.now();
      // 注意第三参才是 options：page.waitForFunction(fn, arg, options)
      await window.waitForFunction(
        () => {
          const imgs = [...document.querySelectorAll<HTMLImageElement>(".asset-card img.asset-thumbnail")];
          return imgs.length > 4 && imgs.every((img) => img.complete && img.naturalWidth > 0);
        },
        undefined,
        { timeout: 180_000 },
      );
      console.log(`NAS_REAL mid-jump all-decoded in ${Date.now() - t1}ms`);
    } else {
      console.log("NAS_REAL sources unreachable on this host — skipping decode phase");
    }
  } finally {
    await application.close();
  }
});
