import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releasePlan } from './release-platforms.mjs';

const tag = 'bestway-app-v0.5.1-rc.2';
const uploaded = name => ({ name, state: 'uploaded', size: 100 });
const existing = ['Bestway.App_0.5.1-rc.2_x64-setup.exe', 'Bestway.App_0.5.1-rc.2_amd64.AppImage',
  'Bestway.App_0.5.1-rc.2_amd64.deb', 'Bestway.App_0.5.1-rc.2_aarch64.dmg', 'Bestway.App_aarch64.app.tar.gz'].map(uploaded);

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
