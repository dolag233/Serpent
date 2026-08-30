import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHotlinkDnrRules,
  HOTLINK_SITES,
  installHotlinkRules,
} from '../../extension/hotlink-sites';

afterEach(() => {
  vi.unstubAllGlobals();
});

function weiboSites() {
  return [
    {
      label: 'Weibo',
      hosts: ['sinaimg.cn'],
      referer: 'https://weibo.com/',
    },
  ];
}

describe('hotlink referer rules', () => {
  it('builds one modifyHeaders rule per CDN host from the registry', () => {
    const rules = buildHotlinkDnrRules([
      {
        label: 'Weibo',
        hosts: ['sinaimg.cn', 'sinaimg.com.cn'],
        referer: 'https://weibo.com/',
      },
    ]);

    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.action.type).toBe('modifyHeaders');
      expect(rule.action.requestHeaders).toEqual([
        { header: 'referer', operation: 'set', value: 'https://weibo.com/' },
      ]);
      expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
      expect(rule.priority).toBe(1);
    }
    expect(rules[0]?.condition.urlFilter).toBe('||sinaimg.cn');
    expect(rules[1]?.condition.urlFilter).toBe('||sinaimg.com.cn');
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(2);
  });

  it('covers the default Weibo entry in the registry', () => {
    const rules = buildHotlinkDnrRules();

    expect(
      rules.some((rule) => rule.condition.urlFilter === '||sinaimg.cn'),
    ).toBe(true);
    expect(
      rules.some((rule) => rule.action.requestHeaders[0]?.value === 'https://weibo.com/'),
    ).toBe(true);
    expect(HOTLINK_SITES.length).toBeGreaterThan(0);
  });

  it('rejects non-https referer values', () => {
    expect(() =>
      buildHotlinkDnrRules([{ label: 'bad', hosts: ['x.cn'], referer: 'http://x.cn/' }]),
    ).toThrow(/https/);
  });

  it('rejects malformed hosts', () => {
    expect(() =>
      buildHotlinkDnrRules([{ label: 'bad', hosts: ['http://x.cn'], referer: 'https://x.cn/' }]),
    ).toThrow(/host/);
  });

  it('registers only its own rule ids, leaving foreign dynamic rules intact', async () => {
    const expected = buildHotlinkDnrRules(weiboSites());
    // 外来动态规则的 id 落在 RULE_BASE_ID 之外，不应被回收。
    const foreignId = 12345;
    const getDynamicRules = vi.fn(async () => [
      { id: foreignId },
      { id: expected[0]?.id as number },
    ]);
    const updateDynamicRules = vi.fn(async () => {});
    vi.stubGlobal('chrome', { declarativeNetRequest: { getDynamicRules, updateDynamicRules } });

    await installHotlinkRules(weiboSites());

    expect(updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [expected[0]?.id],
      addRules: expected,
    });
  });

  it('is idempotent across repeated startups', async () => {
    const sites = weiboSites();
    const rule = buildHotlinkDnrRules(sites)[0];
    const getDynamicRules = vi.fn(async () => [{ id: rule?.id as number }]);
    const updateDynamicRules = vi.fn(async () => {});
    vi.stubGlobal('chrome', { declarativeNetRequest: { getDynamicRules, updateDynamicRules } });

    await installHotlinkRules(sites);
    await installHotlinkRules(sites);

    expect(updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(updateDynamicRules).toHaveBeenNthCalledWith(1, {
      removeRuleIds: [rule?.id],
      addRules: [rule],
    });
    expect(updateDynamicRules).toHaveBeenNthCalledWith(2, {
      removeRuleIds: [rule?.id],
      addRules: [rule],
    });
  });

  it('does not throw when DNR registration fails (best-effort)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('chrome', {
      declarativeNetRequest: {
        getDynamicRules: vi.fn(async () => {
          throw new Error('dnr unavailable');
        }),
        updateDynamicRules: vi.fn(async () => {}),
      },
    });

    await expect(installHotlinkRules()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
