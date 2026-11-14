/**
 * One `latest.json` for the Tauri updater, assembled once after every native build has uploaded
 * its signed bundle. Building it in each matrix job let parallel jobs replace each other's asset
 * (run 42982782068: "Uploading latest.json… Not Found – update-a-release-asset" on Apple Silicon).
 */
export const UPDATER_PLATFORMS = [
  { key: 'windows-x86_64', platform: 'windows-x64', bundle: /_x64-setup\.exe$/ },
  { key: 'linux-x86_64', platform: 'linux-x64', bundle: /_amd64\.AppImage$/ },
  { key: 'darwin-x86_64', platform: 'macos-intel', bundle: /_x64\.app\.tar\.gz$/ },
  { key: 'darwin-aarch64', platform: 'macos-apple-silicon', bundle: /_aarch64\.app\.tar\.gz$/ },
];

const uploaded = (asset) => asset && asset.state === 'uploaded' && asset.size > 0;

/**
 * @param {{ version: string, tag: string, repository: string, notes?: string, pubDate?: string,
 *           assets: {id:number,name:string,state:string,size:number}[],
 *           readSignature: (asset) => Promise<string> }} input
 */
export async function buildUpdaterManifest({ version, tag, repository, notes = '', pubDate = new Date().toISOString(), assets, readSignature }) {
  if (!/^\d+\.\d+\.\d+(-(rc|beta|alpha)\.\d+)?$/.test(version || '')) throw new Error(`Invalid version for latest.json: ${version}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository name');
  const problems = [];
  const platforms = {};
  for (const item of UPDATER_PLATFORMS) {
    const bundles = assets.filter((a) => uploaded(a) && item.bundle.test(a.name) && !a.name.endsWith('.sig'));
    if (bundles.length !== 1) { problems.push(`${item.platform}: expected one updater bundle, found ${bundles.length}`); continue; }
    const signatureAsset = assets.find((a) => uploaded(a) && a.name === `${bundles[0].name}.sig`);
    if (!signatureAsset) { problems.push(`${item.platform}: signature ${bundles[0].name}.sig is missing`); continue; }
    const signature = String(await readSignature(signatureAsset)).trim();
    if (!signature || /\s/.test(signature)) { problems.push(`${item.platform}: signature file is empty or malformed`); continue; }
    platforms[item.key] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(bundles[0].name)}`,
    };
  }
  if (problems.length) throw new Error(`latest.json not written — ${problems.join('; ')}`);
  return { version, notes, pub_date: pubDate, platforms };
}

/** Checks a manifest read back from the release (what installed apps will download). */
export function verifyUpdaterManifest(manifest, version) {
  const errors = [];
  if (manifest?.version !== version) errors.push(`version ${manifest?.version} ≠ ${version}`);
  for (const { key } of UPDATER_PLATFORMS) {
    const entry = manifest?.platforms?.[key];
    if (!entry?.signature || !/^https:\/\/github\.com\//.test(entry?.url || '')) errors.push(`${key} entry is incomplete`);
  }
  if (errors.length) throw new Error(`latest.json check failed — ${errors.join('; ')}`);
  return true;
}
