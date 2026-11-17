import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { findReleaseByTag, releasePlan, buildLatestManifest, PLATFORM_UPDATER_SPECS } from './release-platforms.mjs';

const tag = 'bestway-app-v0.5.1-rc.2';
const uploaded = name => ({ name, state: 'uploaded', size: 100 });
const existing = ['Bestway.App_0.5.1-rc.2_x64-setup.exe', 'Bestway.App_0.5.1-rc.2_amd64.AppImage',
  'Bestway.App_0.5.1-rc.2_amd64.deb', 'Bestway.App_0.5.1-rc.2_aarch64.dmg', 'Bestway.App_aarch64.app.tar.gz'].map(uploaded);

test('draft lookup preserves the existing release ID and uploaded installers', async () => {
  const draft = { id: 409430989, tag_name: 'bestway-app-v0.5.1', draft: true, assets: existing };
  const paths = [];
  assert.equal(await findReleaseByTag(async path => { paths.push(path); return [draft]; }, draft.tag_name), draft);
  assert.deepEqual(paths, ['/releases?per_page=100&page=1']);
});
test('release lookup paginates and matches the exact immutable tag', async () => {
  const first = Array.from({ length: 100 }, () => ({ tag_name: 'bestway-app-v0.5.1-rc.2' }));
  const expected = { id: 1, tag_name: 'bestway-app-v0.5.1' };
  const paths = [];
  assert.equal(await findReleaseByTag(async path => { paths.push(path); return paths.length === 1 ? first : [expected]; }, expected.tag_name), expected);
  assert.deepEqual(paths, ['/releases?per_page=100&page=1', '/releases?per_page=100&page=2']);
});
test('missing release returns null and lookup errors stop upload planning', async () => {
  assert.equal(await findReleaseByTag(async () => [], tag), null);
  await assert.rejects(findReleaseByTag(async () => { throw new Error('HTTP 403'); }, tag), /HTTP 403/);
  await assert.rejects(findReleaseByTag(async () => ({ message: 'bad response' }), tag), /release list/);
});

test('new releases explicitly build four native architectures at the same version', () => {
  const plan = releasePlan(tag);
  assert.equal(plan.hasBuilds, true);
  assert.deepEqual(plan.include.map(row => row.target), ['x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu', 'x86_64-apple-darwin', 'aarch64-apple-darwin']);
  assert.equal(plan.include.find(row => row.platform === 'macos-intel').os, 'macos-15-intel');
});
test('existing rc.2 assets require only Intel macOS and preserve every published installer', () => {
  assert.deepEqual(releasePlan(tag, existing).include.map(row => row.platform), ['macos-intel']);
  assert.equal(releasePlan(tag, existing, 'windows-x64').hasBuilds, false);
});
test('complete release is idempotent and schedules no overwrite', () => {
  const assets = [...existing, uploaded('Bestway.App_0.5.1-rc.2_x64.dmg'), uploaded('Bestway.App_x64.app.tar.gz')];
  assert.deepEqual(releasePlan(tag, assets), { include: [], hasBuilds: false });
});
test('a partial existing bundle fails before duplicate assets can be overwritten', () => {
  assert.throws(() => releasePlan(tag, [existing[1]]), /refusing to overwrite/);
  assert.throws(() => releasePlan(tag, [uploaded('Bestway.App_0.5.1-rc.2_x64.dmg')]), /refusing to overwrite/);
  assert.throws(() => releasePlan(tag, [{ ...existing[0], size: 0 }]), /refusing to overwrite/);
});
test('old versions never satisfy the new version matrix and malformed selection fails', () => {
  assert.equal(releasePlan('bestway-app-v0.5.2', existing.filter(asset => !asset.name.endsWith('.app.tar.gz'))).include.length, 4);
  assert.throws(() => releasePlan('bestway-app-v0.5.2', existing), /refusing to overwrite/);
  assert.throws(() => releasePlan('main', existing), /release tag/);
  assert.throws(() => releasePlan(tag, existing, 'fake-linux-exe'), /Unknown release platform/);
});
test('all current package and lock versions match the native app version', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1];
  const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8').match(/name = "bestway-app"\r?\nversion = "([^"]+)"/)?.[1];
  assert.deepEqual([lock.version, lock.packages[''].version, tauri.version, cargo, cargoLock], Array(5).fill(pkg.version));
});
test('macOS recording is explicitly described and permits audio input only', () => {
  const info = readFileSync('src-tauri/Info.plist', 'utf8');
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const entitlements = readFileSync(`src-tauri/${config.bundle.macOS.entitlements}`, 'utf8');
  assert.match(info, /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
  assert.match(entitlements, /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\s*\/>/);
  assert.equal([...entitlements.matchAll(/<key>/g)].length, 1);
  assert.equal(config.bundle.macOS.signingIdentity, '-');
});

test('buildLatestManifest synthesizes a 4-platform updater manifest with signatures', async () => {
  const version = '0.5.1-rc.2';
  const tag = `bestway-app-v${version}`;
  const updaterAssets = [
    { name: `Bestway.App_${version}_x64-setup.nsis.zip`, state: 'uploaded', size: 1000, browser_download_url: 'https://example.com/win.zip' },
    { name: `Bestway.App_${version}_x64-setup.nsis.zip.sig`, state: 'uploaded', size: 50, signatureText: 'win-sig-data' },
    { name: `Bestway.App_${version}_amd64.AppImage.tar.gz`, state: 'uploaded', size: 1000, browser_download_url: 'https://example.com/linux.tar.gz' },
    { name: `Bestway.App_${version}_amd64.AppImage.tar.gz.sig`, state: 'uploaded', size: 50, signatureText: 'linux-sig-data' },
    { name: 'Bestway.App_x64.app.tar.gz', state: 'uploaded', size: 1000, browser_download_url: 'https://example.com/mac-intel.tar.gz' },
    { name: 'Bestway.App_x64.app.tar.gz.sig', state: 'uploaded', size: 50, signatureText: 'mac-intel-sig-data' },
    { name: 'Bestway.App_aarch64.app.tar.gz', state: 'uploaded', size: 1000, browser_download_url: 'https://example.com/mac-arm.tar.gz' },
    { name: 'Bestway.App_aarch64.app.tar.gz.sig', state: 'uploaded', size: 50, signatureText: 'mac-arm-sig-data' },
  ];

  const manifest = await buildLatestManifest(tag, updaterAssets, (asset) => asset.signatureText, { requireAllPlatforms: true });
  assert.ok(manifest);
  assert.equal(manifest.version, version);
  assert.deepEqual(Object.keys(manifest.platforms), ['windows-x86_64', 'linux-x86_64', 'darwin-x86_64', 'darwin-aarch64']);
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'win-sig-data');
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://example.com/win.zip');
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'mac-arm-sig-data');
  assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://example.com/mac-arm.tar.gz');
});

test('buildLatestManifest returns null when no updater artifacts exist', async () => {
  const manifest = await buildLatestManifest(tag, existing, () => '');
  assert.equal(manifest, null);
});

test('buildLatestManifest throws when a required signature is missing or empty', async () => {
  const incompleteAssets = [
    { name: 'Bestway.App_0.5.1-rc.2_x64-setup.nsis.zip', state: 'uploaded', size: 1000 },
  ];
  await assert.rejects(
    buildLatestManifest(tag, incompleteAssets, () => '', { requireSignatures: true }),
    /Missing signature asset/
  );
});
