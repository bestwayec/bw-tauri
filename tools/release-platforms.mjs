/** Explicit native architectures, with additive uploads for immutable releases. */
export const RELEASE_PLATFORMS = [
  { platform: 'windows-x64', os: 'windows-latest', target: 'x86_64-pc-windows-msvc', suffixes: ['x64-setup.exe'] },
  { platform: 'linux-x64', os: 'ubuntu-22.04', target: 'x86_64-unknown-linux-gnu', suffixes: ['amd64.AppImage', 'amd64.deb'] },
  { platform: 'macos-intel', os: 'macos-15-intel', target: 'x86_64-apple-darwin', suffixes: ['x64.dmg'], archive: 'x64' },
  { platform: 'macos-apple-silicon', os: 'macos-15', target: 'aarch64-apple-darwin', suffixes: ['aarch64.dmg'], archive: 'aarch64' },
];

/** The by-tag endpoint omits drafts; authenticated release lists include them. */
export async function findReleaseByTag(api, tag) {
  for (let page = 1; page <= 100; page++) {
    const releases = await api(`/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('Expected a GitHub release list');
    const release = releases.find(row => row.tag_name === tag);
    if (release) return release;
    if (releases.length < 100) return null;
  }
  throw new Error('Release lookup exceeded its pagination limit');
}

export function releasePlan(tag, assets = [], selected = 'missing') {
  const version = tag.match(/^(?:bestway-app-)?v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:rc|beta|alpha)\.(?:0|[1-9][0-9]*))?)$/)?.[1];
  if (!version) throw new Error('Expected a versioned bestway-app release tag');
  if (selected !== 'missing' && !RELEASE_PLATFORMS.some(row => row.platform === selected)) {
    throw new Error('Unknown release platform');
  }
  const present = new Set(assets.filter(asset => asset.state === 'uploaded' && asset.size > 0).map(asset => asset.name));
  const occupied = new Set(assets.map(asset => asset.name));
  const include = [];
  for (const { suffixes, archive, ...platform } of RELEASE_PLATFORMS) {
    if (selected !== 'missing' && selected !== platform.platform) continue;
    const expected = suffixes.map(suffix => `Bestway.App_${version}_${suffix}`);
    if (archive) expected.push(`Bestway.App_${archive}.app.tar.gz`);
    const complete = expected.every(name => present.has(name));
    if (complete) continue;
    const existing = expected.filter(name => occupied.has(name));
    // The pinned action replaces duplicate asset names. Never schedule a job
    // whose bundle would overwrite even one existing installer/archive.
    if (existing.length) throw new Error(`Incomplete ${platform.platform} assets already exist; refusing to overwrite ${existing.join(', ')}`);
    include.push(platform);
  }
  return { include, hasBuilds: include.length > 0 };
}
