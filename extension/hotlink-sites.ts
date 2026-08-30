/**
 * Referer 防盗链站点 registry + declarativeNetRequest 规则生成。
 *
 * 背景：MV3 background service worker 的跨源 fetch 不发送 Referer（Chromium 行为，
 * fetch init 的 referrer/referrerPolicy 均无效），按 Referer 防盗链的图床
 * （如微博 sinaimg.cn）会对扩展的下载请求返回 HTTP 403。本模块在启动时用
 * chrome.declarativeNetRequest 为已知防盗链 CDN 的 xmlhttprequest 请求注入
 * 目标站点认可的 Referer，扩展其余「SW fetch + 上传 Serpent」流程不变。
 *
 * 新站点接入：在 HOTLINK_SITES 追加一条 { label, hosts, referer }，重启扩展生效；
 * 规则注册幂等，重复启动不会叠加或冲突。Referer 值需以目标站实测为准
 * （带该 Referer 请求 CDN 应返回 200），不要凭空填写。
 */

export interface HotlinkSiteRule {
  /** 站点名称，仅作维护注释。 */
  label: string;
  /** CDN 主机后缀（不含协议），如 'sinaimg.cn' 会同时匹配 *.sinaimg.cn 与 sinaimg.cn。 */
  hosts: readonly string[];
  /** 该 CDN 认可的 Referer 值（完整 https URL）。 */
  referer: string;
}

export const HOTLINK_SITES: readonly HotlinkSiteRule[] = [
  {
    label: 'Weibo',
    hosts: ['sinaimg.cn'],
    referer: 'https://weibo.com/',
  },
];

/** declarativeNetRequest modifyHeaders 规则的紧凑描述（测试用，避免依赖 chrome 类型）。 */
export interface HotlinkDnrRule {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    requestHeaders: Array<{ header: string; operation: 'set'; value: string }>;
  };
  condition: {
    urlFilter: string;
    resourceTypes: string[];
  };
}

/** 规则 id 起始值：预留大间隔，避免与未来静态规则集或其他动态规则冲突。 */
const RULE_BASE_ID = 200000;
const RULE_PRIORITY = 1;
const HTTPS_REFERER = /^https:\/\//u;
const HOST_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/u;

export function buildHotlinkDnrRules(
  sites: readonly HotlinkSiteRule[] = HOTLINK_SITES,
): HotlinkDnrRule[] {
  const rules: HotlinkDnrRule[] = [];
  for (const site of sites) {
    if (!HTTPS_REFERER.test(site.referer)) {
      throw new Error(`Hotlink site ${site.label} referer must be an https URL: ${site.referer}`);
    }
    for (const host of site.hosts) {
      if (!HOST_PATTERN.test(host)) {
        throw new Error(`Hotlink site ${site.label} has an invalid host: ${host}`);
      }
      rules.push({
        id: RULE_BASE_ID + rules.length,
        priority: RULE_PRIORITY,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'referer', operation: 'set', value: site.referer }],
        },
        condition: {
          urlFilter: `||${host}`,
          resourceTypes: ['xmlhttprequest'],
        },
      });
    }
  }
  return rules;
}

/**
 * 幂等注册/更新动态规则：只回收本模块生成过的规则 id（>= RULE_BASE_ID），
 * 不触碰其他动态规则，然后写入当前 registry 的全量规则。
 */
export async function installHotlinkRules(
  sites: readonly HotlinkSiteRule[] = HOTLINK_SITES,
): Promise<void> {
  try {
    const rules = buildHotlinkDnrRules(sites);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ownIds = existing
      .filter((rule) => rule.id >= RULE_BASE_ID)
      .map((rule) => rule.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ownIds,
      addRules: rules,
    });
  } catch (error) {
    // 规则注册失败只影响防盗链站点的保存（仍是下载失败），不应阻断扩展其余功能。
    console.warn('Serpent: failed to install hotlink referer rules', error);
  }
}
