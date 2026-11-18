// The only job that attaches Android, writes updater metadata, and publishes a release.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { releasePlan } from './release-platforms.mjs';
import { buildUpdaterManifest, verifyUpdaterManifest } from './updater-manifest.mjs';

const {
  GITHUB_API_URL, GITHUB_REPOSITORY, GH_TOKEN, RELEASE_TAG, RELEASE_ID, RELEASE_COMMIT,
  DESKTOP_RELEASE_MODE,
} = process.env;
const base = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}`;
const headers = { Authorization: `Bearer ${GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, Accept: 'application/vnd.github+json', ...init.headers },
  });
  if (!response.ok) throw new Error(`GitHub ${init.method || 'GET'} ${new URL(url).pathname} returned HTTP ${response.status}`);
  return response;
}

const api = async (path, init) => (await request(base + path, init)).json();
const assetsFor = (id) => api(`/releases/${id}/assets?per_page=100`);
const assetResponse = (asset) => request(`${base}/releases/assets/${asset.id}`, {
  headers: { Accept: 'application/octet-stream' },
});

async function verifiedDownload(asset, file) {
  assert(asset.state === 'uploaded' && asset.size > 0, `Incomplete asset ${asset.name}`);
  assert.match(asset.digest ?? '', /^sha256:[a-f0-9]{64}$/, `Missing digest for ${asset.name}`);
  const response = await assetResponse(asset);
  const hash = createHash('sha256');
  let size = 0;
  const chunks = [];
  const meter = new Transform({
    transform(chunk, _, callback) {
      hash.update(chunk);
      size += chunk.length;
      if (!file) chunks.push(chunk);
      callback(null, file ? chunk : undefined);
    },
  });
  if (file) await pipeline(response.body, meter, createWriteStream(file));
  else await pipeline(response.body, meter);
  assert.equal(size, asset.size, `Size mismatch for ${asset.name}`);
  assert.equal(`sha256:${hash.digest('hex')}`, asset.digest, `Checksum mismatch for ${asset.name}`);
  return file ? undefined : Buffer.concat(chunks);
}

async function attach(release, assets, name, body, contentType) {
  const existing = assets.filter((asset) => asset.name === name);
  assert(existing.length <= 1, `Duplicate asset ${name}`);
  const url = release.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(name)}`;
  const asset = existing[0] ?? await (await request(url, {
    method: 'POST', body, headers: { 'Content-Type': contentType },
  })).json();
  assert.equal(asset.digest, `sha256:${sha256(body)}`, `Conflicting bytes for ${name}`);
  assert.deepEqual(await verifiedDownload(asset), body, `Read-back mismatch for ${name}`);
}

assert.equal(DESKTOP_RELEASE_MODE, 'signed_updater', 'Stable publication requires signed desktop updates');
assert.match(RELEASE_TAG, /^(?:bestway-app-)?v\d+\.\d+\.\d+$/);
assert.match(RELEASE_ID, /^\d+$/);
assert.match(RELEASE_COMMIT, /^[a-f0-9]{40}$/);

const version = RELEASE_TAG.replace(/^(?:bestway-app-)?v/, '');
const release = await api(`/releases/${RELEASE_ID}`);
assert(release.draft && !release.prerelease && release.tag_name === RELEASE_TAG, 'Expected the stable release draft');
assert.equal(release.target_commitish, RELEASE_COMMIT, 'Release draft source commit mismatch');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), RELEASE_COMMIT);
const ref = await api(`/git/ref/tags/${encodeURIComponent(RELEASE_TAG)}`);
let object = ref.object;
for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
  object = (await api(`/git/tags/${object.sha}`)).object;
}
assert.equal(object.type, 'commit');
assert.equal(object.sha, RELEASE_COMMIT, 'Tag no longer points to the build commit');

const assets = await assetsFor(release.id);
assert.equal(releasePlan(RELEASE_TAG, assets).hasBuilds, false, 'Native installers are incomplete');
const apk = await readFile('release-android/bestway-app.apk');
assert(apk.length >= 3145728, 'APK is below the expected minimum size');
const androidChecksum = (await readFile('release-android/android-sha256.txt', 'utf8')).trim();
assert.equal(androidChecksum, `${sha256(apk)}  bestway-app.apk`, 'APK changed after Android verification');

const temporary = await mkdtemp(join(tmpdir(), 'bestway-release-'));
try {
  const tauri = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(tauri.version, version);
  const publicKey = join(temporary, 'updater.pub');
  await writeFile(publicKey, Buffer.from(tauri.plugins.updater.pubkey, 'base64'));
  const manifest = await buildUpdaterManifest({
    version, tag: RELEASE_TAG, repository: GITHUB_REPOSITORY, notes: release.body || '',
    pubDate: release.created_at, assets,
    readSignature: async (asset) => (await verifiedDownload(asset)).toString('utf8'),
  });
  verifyUpdaterManifest(manifest, version);
  const signedNames = new Set();
  for (const { signature, url } of Object.values(manifest.platforms)) {
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if (signedNames.has(name)) continue;
    const bundle = join(temporary, 'updater-bundle');
    const signatureFile = join(temporary, 'updater-bundle.minisig');
    await verifiedDownload(assets.find((asset) => asset.name === name), bundle);
    await writeFile(signatureFile, Buffer.from(signature, 'base64'));
    execFileSync('minisign', ['-Vm', bundle, '-p', publicKey, '-x', signatureFile], { stdio: 'inherit' });
    signedNames.add(name);
  }
  const otherInstallers = assets.filter((asset) => /\.dmg$/.test(asset.name));
  for (const asset of otherInstallers) {
    await verifiedDownload(asset, join(temporary, 'installer'));
  }

  await attach(release, assets, 'bestway-app.apk', apk, 'application/vnd.android.package-archive');
  await attach(release, assets, 'latest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
  const installable = [...assets.filter((asset) => signedNames.has(asset.name)), ...otherInstallers];
  const checksums = installable.map((asset) => `${asset.digest.slice(7)}  ${asset.name}`);
  checksums.push(androidChecksum);
  await attach(release, assets, 'SHA256SUMS.txt', Buffer.from(checksums.sort().join('\n') + '\n'), 'text/plain');

  const currentLatest = await request(base + '/releases/latest');
  const previous = (await currentLatest.json()).tag_name?.match(/^(?:bestway-app-)?v(\d+)\.(\d+)\.(\d+)$/);
  assert(previous, 'Unable to establish the current stable release version');
  const nextParts = version.split('.').map(BigInt);
  const priorParts = previous.slice(1).map(BigInt);
  const firstChange = nextParts.findIndex((part, index) => part !== priorParts[index]);
  assert(firstChange >= 0 && nextParts[firstChange] > priorParts[firstChange], 'Stable release must advance Latest');

  const published = await api(`/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, prerelease: false, make_latest: 'true' }),
  });
  assert(!published.draft && !published.prerelease && published.tag_name === RELEASE_TAG);
  assert.equal((await api('/releases/latest')).id, release.id, 'GitHub Latest does not match the release');

  const publicBase = `https://github.com/${GITHUB_REPOSITORY}/releases`;
  const publicManifest = `${publicBase}/latest/download/latest.json?release=${encodeURIComponent(RELEASE_TAG)}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(publicManifest, { headers: { 'Cache-Control': 'no-cache' } });
    if (response.ok && (await response.text()) === JSON.stringify(manifest, null, 2)) break;
    if (attempt === 5) throw new Error('The public Latest manifest does not match the verified draft');
    await delay(5_000);
  }
  await Promise.all([...installable.map((asset) => asset.name), 'bestway-app.apk'].map(async (name) => {
    const url = `${publicBase}/download/${encodeURIComponent(RELEASE_TAG)}/${encodeURIComponent(name)}`;
    const response = await fetch(url, { method: 'HEAD' });
    assert(response.ok, `Public download returned HTTP ${response.status} for ${name}`);
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
