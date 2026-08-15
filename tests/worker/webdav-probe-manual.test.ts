/**
 * 手动 WebDAV 端点探测（Serpent-xffq）。
 *
 * 运行方式（URL 不写进本文件，仅供开发者手动连接测试）：
 *   $env:SERPENT_WEBDAV_PROBE_URL='https://<host>/'; `
 *   node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts `
 *     tests/worker/webdav-probe-manual.test.ts
 * 可选 SERPENT_WEBDAV_PROBE_USER / SERPENT_WEBDAV_PROBE_PASS 提供凭据。
 */
import { describe, expect, it } from 'vitest';

import { WebDAVDriver } from '../../src/worker/sync/webdav-driver';
import type { DriverCapabilities } from '../../src/worker/sync/remote-storage';

const probeUrl = process.env.SERPENT_WEBDAV_PROBE_URL;

describe.skipIf(!probeUrl)('manual WebDAV endpoint probe', () => {
  it('probes capabilities and exercises list/write/read/delete against the real server', async () => {
    const driver = new WebDAVDriver({
      baseUrl: probeUrl!,
      username: process.env.SERPENT_WEBDAV_PROBE_USER,
      password: process.env.SERPENT_WEBDAV_PROBE_PASS,
      // 手动探测场景默认允许自签名证书（局域网 IP 常见）。
      allowInsecureTls: true,
      timeoutMs: 30_000,
    });

    const capabilities: DriverCapabilities = await driver.probe();
    console.log('[webdav-probe] capabilities:', JSON.stringify(capabilities, null, 2));

    // 目录创建与列举。
    const probeDir = `.serpent-sync/probe-${Date.now()}`;
    await driver.mkdir(probeDir);

    // 写入 + 读取回校验。
    const payload = Buffer.from(`serpent-probe-${Date.now()}-${'x'.repeat(1024)}`);
    const writeResult = await driver.write(`${probeDir}/hello.bin`, payload);
    const readBack = await driver.read(`${probeDir}/hello.bin`);
    expect(readBack.body.equals(payload)).toBe(true);
    console.log('[webdav-probe] write/read OK, etag:', writeResult.etag ?? '(none)');

    // 列举该目录。
    const entries = await driver.list(`${probeDir}/`, '1');
    console.log('[webdav-probe] list:', JSON.stringify(entries));

    // 清理。
    await driver.delete(`${probeDir}/hello.bin`);
    await driver.delete(`${probeDir}/`);
    console.log('[webdav-probe] cleanup OK');
  }, 120_000);
});
