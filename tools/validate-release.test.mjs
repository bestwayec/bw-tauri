import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateRelease } from './validate-release.mjs';

const versions = { packageVersion: '0.5.1-rc.2', tauriVersion: '0.5.1-rc.2', cargoVersion: '0.5.1-rc.2' };
const env = { VITE_API_URL: 'https://api.example.test/v1', VITE_WEB_URL: 'https://example.test', GITHUB_REF_NAME: 'bestway-app-v0.5.1-rc.2' };

test('default manual release needs no signing key and suppresses updater artifacts only through an overlay', () => {
  const release = validateRelease(env, versions);
  assert.equal(release.mode, 'manual_installer');
  assert.equal(release.includeUpdaterJson, false);
  assert.equal(release.args, '--config src-tauri/tauri.manual-installer.conf.json');
  const base = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const overlay = JSON.parse(readFileSync('src-tauri/tauri.manual-installer.conf.json', 'utf8'));
  assert.equal(base.bundle.createUpdaterArtifacts, true);
  assert.equal(overlay.bundle.createUpdaterArtifacts, false);
  assert.equal(Object.hasOwn(overlay, 'plugins'), false);
});

test('signed release requires a signing key', () => {
  assert.throws(() => validateRelease({ ...env, DESKTOP_RELEASE_MODE: 'signed_updater' }, versions), /TAURI_SIGNING_PRIVATE_KEY/);
});

test('signed release preserves the base updater configuration', () => {
  const release = validateRelease({ ...env, DESKTOP_RELEASE_MODE: 'signed_updater', TAURI_SIGNING_PRIVATE_KEY: 'synthetic-test-key' }, versions);
  assert.equal(release.includeUpdaterJson, true);
  assert.equal(release.args, '');
});

test('unknown modes fail instead of silently disabling signing', () => {
  assert.throws(() => validateRelease({ ...env, DESKTOP_RELEASE_MODE: 'signed' }, versions), /DESKTOP_RELEASE_MODE/);
});

for (const mode of ['manual_installer', 'signed_updater']) {
  test(`${mode} preserves HTTPS and version gates`, () => {
    const releaseEnv = { ...env, DESKTOP_RELEASE_MODE: mode, TAURI_SIGNING_PRIVATE_KEY: 'synthetic-test-key' };
    assert.throws(() => validateRelease({ ...releaseEnv, VITE_API_URL: 'http://api.example.test/v1' }, versions), /HTTPS/);
    assert.throws(() => validateRelease({ ...releaseEnv, VITE_API_URL: 'https://api.example.test' }, versions), /ending in \/v1/);
    assert.throws(() => validateRelease({ ...releaseEnv, VITE_WEB_URL: 'https://localhost' }, versions), /HTTPS/);
    assert.throws(() => validateRelease({ ...releaseEnv, GITHUB_REF_NAME: 'bestway-app-v0.5.1' }, versions), /versions must match/);
    assert.throws(() => validateRelease(releaseEnv, { ...versions, cargoVersion: '0.5.0' }), /versions must match/);
  });
}
