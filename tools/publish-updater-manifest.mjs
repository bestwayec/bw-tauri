// Publish job step: write `latest.json` once, after every platform's signed bundle is on the draft.
import { findReleaseByTag } from './release-platforms.mjs';
import { buildUpdaterManifest, verifyUpdaterManifest } from './updater-manifest.mjs';

const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GH_TOKEN, RELEASE_TAG, RELEASE_ID } = process.env;
const headers = { Authorization: `Bearer ${GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' };
const base = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}`;

async function api(path, init = {}) {
  const response = await fetch(path.startsWith('http') ? path : base + path, { ...init, headers: { ...headers, Accept: 'application/vnd.github+json', ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} returned HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function assetText(asset) {
  const response = await fetch(`${base}/releases/assets/${asset.id}`, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`Downloading ${asset.name} returned HTTP ${response.status}`);
  return response.text();
}

const release = RELEASE_ID ? await api(`/releases/${RELEASE_ID}`) : await findReleaseByTag(api, RELEASE_TAG);
if (!release || release.tag_name !== RELEASE_TAG) throw new Error('The expected release draft was not found');
const version = RELEASE_TAG.replace(/^(?:bestway-app-)?v/, '');
const assets = await api(`/releases/${release.id}/assets?per_page=100`);
const manifest = await buildUpdaterManifest({ version, tag: RELEASE_TAG, repository: GITHUB_REPOSITORY, notes: release.body || '', assets, readSignature: assetText });
for (const old of assets.filter((a) => a.name === 'latest.json')) await api(`/releases/assets/${old.id}`, { method: 'DELETE' });
const uploadUrl = release.upload_url.replace(/\{.*\}$/, '') + '?name=latest.json';
const body = JSON.stringify(manifest, null, 2);
await api(uploadUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
const written = (await api(`/releases/${release.id}/assets?per_page=100`)).filter((a) => a.name === 'latest.json');
if (written.length !== 1) throw new Error(`Expected one latest.json on the release, found ${written.length}`);
verifyUpdaterManifest(JSON.parse(await assetText(written[0])), version);
console.log(`latest.json written once for ${RELEASE_TAG}: ${Object.keys(manifest.platforms).join(', ')}`);
