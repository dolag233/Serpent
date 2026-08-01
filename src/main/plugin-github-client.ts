import {
  type PluginFetch,
  type PluginGitHubClient,
  type PluginGitHubRelease,
  PluginPackageManagerError,
} from './plugin-package-manager-types';
import { parseGitHubRepositoryUrl } from '../shared/plugin-github-url';

export { parseGitHubRepositoryUrl, isGitHubPluginInstallUrl } from '../shared/plugin-github-url';

async function githubJson(fetchImpl: PluginFetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', `GitHub request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

/**
 * Downloads Release platform assets (preferred) or already-built source archives.
 * It has no package manager, shell, build or lifecycle-script capability.
 */
export function createGitHubPluginClient(fetchImpl: PluginFetch = fetch): PluginGitHubClient {
  const githubApiRoot = 'https://api.github.com/repos';
  const commitForRef = async (repository: string, ref: string): Promise<string> => {
    const { owner, name } = parseGitHubRepositoryUrl(repository);
    const body = await githubJson(fetchImpl, `${githubApiRoot}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(ref)}`);
    const sha = (body as { sha?: unknown }).sha;
    if (typeof sha !== 'string' || !/^[a-f0-9]{40,64}$/u.test(sha)) {
      throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub returned an invalid commit SHA.');
    }
    return sha;
  };
  return {
    async listTags(repository: string): Promise<Array<{ name: string; commitSha: string }>> {
      const { owner, name } = parseGitHubRepositoryUrl(repository);
      const body = await githubJson(fetchImpl, `${githubApiRoot}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tags?per_page=100`);
      if (!Array.isArray(body)) throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub returned an invalid tag list.');
      return body.flatMap((tag) => {
        const nameValue = (tag as { name?: unknown }).name;
        const commitSha = (tag as { commit?: { sha?: unknown } }).commit?.sha;
        return typeof nameValue === 'string' && typeof commitSha === 'string' && /^[a-f0-9]{40,64}$/u.test(commitSha)
          ? [{ name: nameValue, commitSha }]
          : [];
      });
    },
    async defaultBranch(repository: string): Promise<{ name: string; commitSha: string }> {
      const { owner, name } = parseGitHubRepositoryUrl(repository);
      const body = await githubJson(fetchImpl, `${githubApiRoot}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
      const branch = (body as { default_branch?: unknown }).default_branch;
      if (typeof branch !== 'string' || branch.length === 0) {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub returned no default branch for the plugin repository.');
      }
      return { name: branch, commitSha: await commitForRef(repository, branch) };
    },
    async listReleases(repository: string): Promise<PluginGitHubRelease[]> {
      const { owner, name } = parseGitHubRepositoryUrl(repository);
      const body = await githubJson(
        fetchImpl,
        `${githubApiRoot}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases?per_page=30`,
      );
      if (!Array.isArray(body)) {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub returned an invalid release list.');
      }
      return body.flatMap((release) => {
        const tagName = (release as { tag_name?: unknown }).tag_name;
        const draft = (release as { draft?: unknown }).draft === true;
        const prerelease = (release as { prerelease?: unknown }).prerelease === true;
        const assetsRaw = (release as { assets?: unknown }).assets;
        if (typeof tagName !== 'string' || tagName.length === 0 || !Array.isArray(assetsRaw)) return [];
        const assets = assetsRaw.flatMap((asset) => {
          const assetName = (asset as { name?: unknown }).name;
          const browserDownloadUrl = (asset as { browser_download_url?: unknown }).browser_download_url;
          const size = (asset as { size?: unknown }).size;
          return typeof assetName === 'string'
            && typeof browserDownloadUrl === 'string'
            && typeof size === 'number'
            && Number.isFinite(size)
            && size >= 0
            ? [{ name: assetName, browserDownloadUrl, size }]
            : [];
        });
        return [{ tagName, draft, prerelease, assets }];
      });
    },
    async downloadReleaseAsset(browserDownloadUrl: string): Promise<Uint8Array> {
      let url: URL;
      try {
        url = new URL(browserDownloadUrl);
      } catch {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub release asset URL is invalid.');
      }
      if (url.protocol !== 'https:') {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'GitHub release asset URL must be HTTPS.');
      }
      const response = await fetchImpl(browserDownloadUrl, {
        headers: { Accept: 'application/octet-stream' },
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', `GitHub release asset download failed with HTTP ${response.status}.`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async downloadArchive(repository: string, ref: string): Promise<{ archive: Uint8Array; commitSha: string }> {
      const { owner, name } = parseGitHubRepositoryUrl(repository);
      const [commitSha, response] = await Promise.all([
        commitForRef(repository, ref),
        fetchImpl(`${githubApiRoot}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/zipball/${encodeURIComponent(ref)}`, {
          headers: { Accept: 'application/vnd.github+json' },
        }),
      ]);
      if (!response.ok) {
        throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', `GitHub archive download failed with HTTP ${response.status}.`);
      }
      return { archive: new Uint8Array(await response.arrayBuffer()), commitSha };
    },
    async commitShaForRef(repository: string, ref: string): Promise<string> {
      return commitForRef(repository, ref);
    },
  };
}
