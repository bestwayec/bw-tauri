import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUpdaterManifest, verifyUpdaterManifest } from './updater-manifest.mjs';

const asset = (id, name) => ({ id, name, state: 'uploaded', size: 10 });
const complete = [
  asset(1, 'Bestway.App_1.0.13_x64-setup.exe'), asset(2, 'Bestway.App_1.0.13_x64-setup.exe.sig'),
  asset(3, 'Bestway.App_1.0.13_amd64.AppImage'), asset(4, 'Bestway.App_1.0.13_amd64.AppImage.sig'), asset(5, 'Bestway.App_1.0.13_amd64.deb'),
  asset(6, 'Bestway.App_x64.app.tar.gz'), asset(7, 'Bestway.App_x64.app.tar.gz.sig'), asset(8, 'Bestway.App_1.0.13_x64.dmg'),
  asset(9, 'Bestway.App_aarch64.app.tar.gz'), asset(10, 'Bestway.App_aarch64.app.tar.gz.sig'), asset(11, 'Bestway.App_1.0.13_aarch64.dmg'),
];
const readSignature = async (a) => `sig-for-${a.id}`;
const input = { version: '1.0.13', tag: 'v1.0.13', repository: 'bestwayec/bw-tauri', pubDate: '2026-11-14T00:00:00Z', assets: complete, readSignature };

test('one manifest names all four updater platforms with their own signature and download URL', async () => {
  const manifest = await buildUpdaterManifest(input);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']);
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'sig-for-10');
  assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://github.com/bestwayec/bw-tauri/releases/download/v1.0.13/Bestway.App_aarch64.app.tar.gz');
  assert.equal(manifest.platforms['windows-x86_64'].url.endsWith('/Bestway.App_1.0.13_x64-setup.exe'), true);
  assert.equal(verifyUpdaterManifest(manifest, '1.0.13'), true);
});

test('a missing platform bundle or signature stops the release with its name', async () => {
  await assert.rejects(buildUpdaterManifest({ ...input, assets: complete.filter((a) => a.id !== 10) }), /macos-apple-silicon: signature Bestway\.App_aarch64\.app\.tar\.gz\.sig is missing/);
  await assert.rejects(buildUpdaterManifest({ ...input, assets: complete.filter((a) => a.id !== 3) }), /linux-x64: expected one updater bundle, found 0/);
  await assert.rejects(buildUpdaterManifest({ ...input, assets: complete.map((a) => (a.id === 6 ? { ...a, state: 'starter' } : a)) }), /macos-intel/);
  await assert.rejects(buildUpdaterManifest({ ...input, readSignature: async () => '  ' }), /signature file is empty/);
  await assert.rejects(buildUpdaterManifest({ ...input, version: 'v1.0.13' }), /Invalid version/);
});

test('a manifest read back with a missing platform or another version fails the check', () => {
  assert.throws(() => verifyUpdaterManifest({ version: '1.0.12', platforms: {} }, '1.0.13'), /version 1\.0\.12 ≠ 1\.0\.13.*windows-x86_64/);
});
