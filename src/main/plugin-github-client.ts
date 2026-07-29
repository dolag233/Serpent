import {
  type PluginFetch,
  type PluginGitHubClient,
  PluginPackageManagerError,
} from './plugin-package-manager-types';

export function parseGitHubRepositoryUrl(value: string): { repository: string; owner: string; name: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Plugin installation requires a valid GitHub repository URL.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || segments.length !== 2) {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Plugin installation requires an HTTPS GitHub owner/repository URL.');
  }
  const owner = segments[0];
  const name = segments[1]?.replace(/\.git$/u, '');
  if (owner === undefined || name === undefined || name.length === 0) {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Plugin installation requires an HTTPS GitHub owner/repository URL.');
  }
  return { repository: `https://github.com/${owner}/${name}`, owner, name };
}

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
 * Downloads already-built GitHub source archives only. It has no package
 * manager, shell, build or lifecycle-script capability.
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
  };
}
