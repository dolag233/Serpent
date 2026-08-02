/**
 * Renderer-safe GitHub install URL parsing (no network).
 * Accepts repository roots and Release pages.
 */

export type ParsedGitHubPluginRepository = {
  repository: string;
  owner: string;
  name: string;
  preferredTag?: string;
  preferLatestRelease: boolean;
};

export function parseGitHubRepositoryUrl(value: string): ParsedGitHubPluginRepository {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Plugin installation requires a valid GitHub repository URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('Plugin installation requires an HTTPS GitHub owner/repository URL.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('Plugin installation requires an HTTPS GitHub owner/repository URL.');
  }
  const owner = segments[0];
  const name = segments[1]?.replace(/\.git$/u, '');
  if (owner === undefined || name === undefined || name.length === 0) {
    throw new Error('Plugin installation requires an HTTPS GitHub owner/repository URL.');
  }
  const repository = `https://github.com/${owner}/${name}`;
  if (segments.length === 2) {
    return { repository, owner, name, preferLatestRelease: true };
  }
  if (segments[2] !== 'releases') {
    throw new Error('Plugin installation requires an HTTPS GitHub owner/repository URL.');
  }
  if (segments.length === 3 || (segments.length === 4 && segments[3] === 'latest')) {
    return { repository, owner, name, preferLatestRelease: true };
  }
  if (segments.length === 5 && segments[3] === 'tag' && typeof segments[4] === 'string' && segments[4].length > 0) {
    return {
      repository,
      owner,
      name,
      preferredTag: segments[4],
      preferLatestRelease: false,
    };
  }
  throw new Error('Plugin installation requires an HTTPS GitHub owner/repository URL.');
}

export function isGitHubPluginInstallUrl(value: string): boolean {
  try {
    parseGitHubRepositoryUrl(value);
    return true;
  } catch {
    return false;
  }
}
